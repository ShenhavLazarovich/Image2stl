import os
from flask import Flask, request, render_template, jsonify, send_file, send_from_directory
import cv2
import numpy as np
import open3d as o3d
from PIL import Image
from werkzeug.utils import secure_filename
import time
import threading
from functools import wraps
import uuid

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

# Create necessary directories
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs('static', exist_ok=True)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg'}

# Store active tasks and their file mappings
active_tasks = {}
file_mappings = {}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

class ConversionTask:
    def __init__(self):
        self.cancelled = False
        self.thread = None
        self.result = None
        self.error = None
        self.completed = False
        self.output_id = str(uuid.uuid4())  # Generate unique ID for output files
        self.start_time = time.time()
        self.last_update = time.time()

    def update_status(self):
        self.last_update = time.time()

    def is_stuck(self):
        return (time.time() - self.last_update) > 300  # 5 minutes timeout

def check_cancelled():
    task_id = threading.current_thread().task_id
    if task_id in active_tasks and active_tasks[task_id].cancelled:
        raise Exception("Task cancelled by user")

def create_3d_model(image_path, params, task_id):
    threading.current_thread().task_id = task_id
    task = active_tasks[task_id]

    # Set stable defaults if not provided
    depth_scale = float(params.get('depth_scale', 8))
    edge_weight = float(params.get('edge_weight', 1.0))
    point_density = int(params.get('point_density', 2))
    reconstruction_method = params.get('reconstruction_method', 'height-field')  # Default to height-field
    blur_amount = int(params.get('blur_amount', 3))
    mesh_smoothing = int(params.get('mesh_smoothing', 1))
    model_size = float(params.get('model_size', 50))  # in mm
    crop_shape = params.get('crop_shape', 'rect')

    try:
        check_cancelled()
        task.update_status()
        # Use PIL to load image and check for alpha channel (for circular crop)
        pil_img = Image.open(image_path)
        img = cv2.imread(image_path)
        if img is None:
            raise Exception("Could not read the image")

        check_cancelled()
        task.update_status()
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
        enhanced = clahe.apply(gray)

        check_cancelled()
        if blur_amount > 0:
            kernel_size = 2 * blur_amount + 1
            blurred = cv2.GaussianBlur(enhanced, (kernel_size, kernel_size), 0)
        else:
            blurred = enhanced

        check_cancelled()
        edges_strong = cv2.Canny(blurred, 100, 200)
        edges_weak = cv2.Canny(blurred, 30, 100)
        edges = cv2.addWeighted(edges_strong, 0.7, edges_weak, 0.3, 0)

        depth_map = blurred.astype(float) / 255.0
        edge_influence = cv2.GaussianBlur(edges.astype(float) / 255.0, (5, 5), 0)
        depth_map = depth_map * (1 + edge_influence * edge_weight)
        depth_map *= depth_scale

        # Mask for circular crop (use alpha channel if present)
        if crop_shape == 'circle' and pil_img.mode in ('RGBA', 'LA'):
            alpha = np.array(pil_img.split()[-1]) / 255.0
            depth_map *= alpha

        height, width = depth_map.shape
        stride = point_density
        y_coords, x_coords = np.mgrid[0:height:stride, 0:width:stride]
        z_coords = depth_map[::stride, ::stride]

        try:
            vertices = np.stack([x_coords, y_coords, z_coords], axis=-1).reshape(-1, 3)
            h, w = z_coords.shape
            faces = []
            for i in range(h - 1):
                for j in range(w - 1):
                    idx = i * w + j
                    faces.append([idx, idx + 1, idx + w])
                    faces.append([idx + 1, idx + w + 1, idx + w])
            faces = np.array(faces, dtype=np.int32)
            if len(vertices) == 0 or len(faces) == 0:
                raise Exception("Height-field mesh is empty")
            mesh = o3d.geometry.TriangleMesh()
            mesh.vertices = o3d.utility.Vector3dVector(vertices)
            mesh.triangles = o3d.utility.Vector3iVector(faces)
            mesh.compute_vertex_normals()
            if mesh_smoothing > 0:
                for _ in range(mesh_smoothing):
                    mesh = mesh.filter_smooth_simple(number_of_iterations=1)
                    mesh.compute_vertex_normals()
            mesh.remove_degenerate_triangles()
            mesh.remove_duplicated_triangles()
            mesh.remove_duplicated_vertices()
            mesh.remove_non_manifold_edges()
            if len(mesh.vertices) == 0 or len(mesh.triangles) == 0:
                raise Exception("Height-field mesh cleanup resulted in an empty mesh")
        except Exception as e:
            # Fallback to Poisson if height-field fails
            pcd = o3d.geometry.PointCloud()
            points = np.stack([x_coords.ravel(), y_coords.ravel(), z_coords.ravel()], axis=-1).astype(np.float32)
            valid_points = ~np.isnan(points).any(axis=1) & ~np.isinf(points).any(axis=1)
            points = points[valid_points]
            if len(points) < 4:
                raise Exception("Not enough valid points to create a mesh")
            pcd.points = o3d.utility.Vector3dVector(points)
            pcd.estimate_normals(
                search_param=o3d.geometry.KDTreeSearchParamHybrid(
                    radius=max(width, height) / 50.0,
                    max_nn=50
                )
            )
            pcd.orient_normals_towards_camera_location([width/2, height/2, -1000])
            pcd, _ = pcd.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)
            mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
                pcd, depth=9, scale=1.1, linear_fit=True
            )
            vertices_to_remove = densities < np.quantile(densities, 0.1)
            mesh.remove_vertices_by_mask(vertices_to_remove)
            if mesh_smoothing > 0:
                for _ in range(mesh_smoothing):
                    mesh = mesh.filter_smooth_simple(number_of_iterations=1)
                    mesh.compute_vertex_normals()
            mesh.remove_degenerate_triangles()
            mesh.remove_duplicated_triangles()
            mesh.remove_duplicated_vertices()
            mesh.remove_non_manifold_edges()
            if len(mesh.vertices) == 0 or len(mesh.triangles) == 0:
                raise Exception("Poisson mesh cleanup resulted in an empty mesh")

        # Scale mesh to requested model_size (mm)
        vertices = np.asarray(mesh.vertices)
        min_xy = vertices[:, :2].min(axis=0)
        max_xy = vertices[:, :2].max(axis=0)
        current_size = max(max_xy - min_xy)
        if current_size > 0:
            scale = model_size / current_size
            vertices[:, :3] *= scale
            mesh.vertices = o3d.utility.Vector3dVector(vertices)

        output_path = os.path.join(app.config['UPLOAD_FOLDER'], f'output_{task.output_id}.stl')
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        try:
            o3d.io.write_triangle_mesh(output_path, mesh, write_ascii=False)
            if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
                raise Exception("Failed to write STL file or file is empty. Try adjusting your parameters or using a different image.")
            task.update_status()
            return output_path
        except Exception as e:
            raise Exception(f"Failed to save mesh: {str(e)}")
        
    except Exception as e:
        task.error = str(e)
        task.completed = True
        raise

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory('static', filename)

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if file and allowed_file(file.filename):
        try:
            filename = secure_filename(file.filename)
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
            
            return jsonify({
                'success': True,
                'message': 'Image uploaded successfully',
                'filename': filename
            })
        except Exception as e:
            return jsonify({'error': f'Error uploading file: {str(e)}'}), 500
    
    return jsonify({'error': 'Invalid file type'}), 400

@app.route('/convert', methods=['POST'])
def convert_file():
    try:
        data = request.get_json()
        if not data or 'filename' not in data:
            return jsonify({'error': 'No filename provided'}), 400
            
        filename = secure_filename(data['filename'])
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        if not os.path.exists(filepath):
            return jsonify({'error': 'Image file not found'}), 404
        
        # Get parameters from the request
        params = {
            'depth_scale': float(data.get('depth_scale', 10)),
            'edge_weight': float(data.get('edge_weight', 1.0)),
            'point_density': int(data.get('point_density', 2)),
            'reconstruction_method': data.get('reconstruction_method', 'auto'),
            'blur_amount': int(data.get('blur_amount', 5)),
            'mesh_smoothing': int(data.get('mesh_smoothing', 0)),
            'model_size': float(data.get('model_size', 50)),
            'crop_shape': data.get('crop_shape', 'rect')
        }
        
        # Create a new task
        task_id = str(int(time.time() * 1000))  # Use timestamp as task ID
        task = ConversionTask()
        active_tasks[task_id] = task
        
        def run_conversion():
            try:
                output_path = create_3d_model(filepath, params, task_id)
                task.result = output_path
            except Exception as e:
                task.error = str(e)
            finally:
                task.completed = True
        
        # Start conversion in a separate thread
        task.thread = threading.Thread(target=run_conversion)
        task.thread.start()
        
        return jsonify({
            'success': True,
            'message': 'Conversion started',
            'task_id': task_id
        })
        
    except Exception as e:
        return jsonify({'error': f'Error starting conversion: {str(e)}'}), 500

@app.route('/status/<task_id>')
def check_status(task_id):
    if task_id not in active_tasks:
        return jsonify({'error': 'Task not found'}), 404
    
    task = active_tasks[task_id]
    
    # Check if task is stuck
    if task.is_stuck():
        task.error = "Task timed out"
        task.completed = True
    
    if task.completed:
        if task.error:
            response = {'status': 'error', 'error': task.error}
        else:
            response = {
                'status': 'completed',
                'preview_url': f'/preview/{task.output_id}',
                'download_url': f'/download/{task.output_id}'
            }
        # Clean up completed task
        del active_tasks[task_id]
        return jsonify(response)
    
    # Update task status
    task.update_status()
    return jsonify({'status': 'processing'})

@app.route('/cancel/<task_id>')
def cancel_task(task_id):
    if task_id not in active_tasks:
        return jsonify({'error': 'Task not found'}), 404
    
    task = active_tasks[task_id]
    task.cancelled = True
    
    # Wait for the thread to complete
    if task.thread and task.thread.is_alive():
        task.thread.join(timeout=5)
    
    # Clean up cancelled task
    del active_tasks[task_id]
    
    return jsonify({'status': 'cancelled'})

@app.route('/preview/<output_id>')
def preview_file(output_id):
    try:
        output_path = os.path.join(app.config['UPLOAD_FOLDER'], f'output_{output_id}.stl')
        if not os.path.exists(output_path):
            return jsonify({'error': 'STL file not found'}), 404
        return send_file(output_path, mimetype='model/stl')
    except Exception as e:
        print(f"Preview error: {str(e)}")
        return jsonify({'error': f'Error serving preview: {str(e)}'}), 500

@app.route('/download/<output_id>')
def download_file(output_id):
    try:
        output_path = os.path.join(app.config['UPLOAD_FOLDER'], f'output_{output_id}.stl')
        if not os.path.exists(output_path):
            return jsonify({'error': 'STL file not found'}), 404
        return send_file(output_path, as_attachment=True, download_name='model.stl', mimetype='application/octet-stream')
    except Exception as e:
        print(f"Download error: {str(e)}")
        return jsonify({'error': f'Error downloading file: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(debug=True) 