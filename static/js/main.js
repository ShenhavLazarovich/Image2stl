// Main JavaScript file for the application
document.addEventListener('DOMContentLoaded', function() {
    console.log('Application loaded');
    
    // Initialize elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const generateBtn = document.getElementById('generate-btn');
    const loading = document.getElementById('loading');
    const loadingText = document.getElementById('loading-text');
    const result = document.getElementById('result');
    const downloadLink = document.getElementById('download-link');
    
    // Cropper elements
    const cropperModal = document.getElementById('cropper-modal');
    const cropperImage = document.getElementById('cropper-image');
    const cropperCancel = document.getElementById('cropper-cancel');
    const cropperConfirm = document.getElementById('cropper-confirm');
    const cropperShapeRect = document.getElementById('cropper-shape-rect');
    const cropperShapeCircle = document.getElementById('cropper-shape-circle');
    let cropper = null;
    let cropShape = 'circle'; // default

    let currentFilename = null;
    let currentTaskId = null;
    let statusCheckInterval = null;
    let lastUploadedFile = null;

    // Crop shape toggle handlers
    cropperShapeRect.addEventListener('click', function() {
        cropShape = 'rect';
        cropperShapeRect.classList.add('bg-blue-500', 'text-white');
        cropperShapeCircle.classList.remove('bg-blue-500', 'text-white');
        // Remove circular overlay
        document.querySelectorAll('#cropper-modal .cropper-crop-box, #cropper-modal .cropper-view-box').forEach(el => {
            el.style.borderRadius = '0';
        });
    });
    cropperShapeCircle.addEventListener('click', function() {
        cropShape = 'circle';
        cropperShapeCircle.classList.add('bg-blue-500', 'text-white');
        cropperShapeRect.classList.remove('bg-blue-500', 'text-white');
        // Add circular overlay
        document.querySelectorAll('#cropper-modal .cropper-crop-box, #cropper-modal .cropper-view-box').forEach(el => {
            el.style.borderRadius = '50%';
        });
    });

    // Show cropping modal and initialize Cropper.js
    function showCropper(file) {
        cropperImage.src = URL.createObjectURL(file);
        cropperModal.classList.remove('hidden');
        setTimeout(() => {
            cropper = new Cropper(cropperImage, {
                aspectRatio: NaN, // Free aspect
                viewMode: 1,
                autoCropArea: 1,
                movable: true,
                zoomable: true,
                scalable: true,
                rotatable: true
            });
            // Set initial crop shape
            if (cropShape === 'circle') {
                cropperShapeCircle.click();
            } else {
                cropperShapeRect.click();
            }
        }, 100);
    }

    // Hide cropping modal and destroy Cropper.js
    function hideCropper() {
        cropperModal.classList.add('hidden');
        if (cropper) {
            cropper.destroy();
            cropper = null;
        }
        cropperImage.src = '';
    }

    cropperCancel.addEventListener('click', function() {
        hideCropper();
        resetDropZone();
    });

    cropperConfirm.addEventListener('click', function() {
        if (!cropper) return;
        if (cropShape === 'circle') {
            // Get cropped canvas, then mask to circle
            const canvas = cropper.getCroppedCanvas();
            const size = Math.min(canvas.width, canvas.height);
            const circleCanvas = document.createElement('canvas');
            circleCanvas.width = size;
            circleCanvas.height = size;
            const ctx = circleCanvas.getContext('2d');
            ctx.clearRect(0, 0, size, size);
            ctx.save();
            ctx.beginPath();
            ctx.arc(size/2, size/2, size/2, 0, 2 * Math.PI);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(canvas, (size-canvas.width)/2, (size-canvas.height)/2);
            ctx.restore();
            // Make outside transparent
            ctx.globalCompositeOperation = 'destination-in';
            ctx.beginPath();
            ctx.arc(size/2, size/2, size/2, 0, 2 * Math.PI);
            ctx.closePath();
            ctx.fill();
            circleCanvas.toBlob(function(blob) {
                handleCroppedUpload(blob);
                hideCropper();
            }, 'image/png');
        } else {
            cropper.getCroppedCanvas().toBlob(function(blob) {
                handleCroppedUpload(blob);
                hideCropper();
            }, 'image/png');
        }
    });

    // Function to show loading state
    function showLoading(message = 'Processing...') {
        loading.classList.remove('hidden');
        loading.classList.add('active');
        loadingText.textContent = message;
    }

    // Function to hide loading state
    function hideLoading() {
        loading.classList.remove('active');
        loading.classList.add('hidden');
    }

    // Function to handle file upload (shows cropper)
    function handleFileUpload(file) {
        if (!file) return;
        lastUploadedFile = file;
        showCropper(file);
    }

    // Function to handle cropped image upload
    function handleCroppedUpload(blob) {
        const formData = new FormData();
        formData.append('file', blob, 'cropped.png');
        showLoading('Uploading cropped image...');
        generateBtn.disabled = true;
        fetch('/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                currentFilename = data.filename;
                generateBtn.disabled = false;
                hideLoading();
                // Show preview of cropped image
                dropZone.innerHTML = `
                    <p class="text-green-600">Image uploaded and cropped!</p>
                    <img src="${URL.createObjectURL(blob)}" class="max-h-32 mx-auto mt-4 rounded-lg shadow" onload="URL.revokeObjectURL(this.src)">
                `;
            } else {
                throw new Error(data.error || 'Unknown error occurred');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            hideLoading();
            generateBtn.disabled = true;
            currentFilename = null;
            alert('Error uploading image: ' + error.message);
            resetDropZone();
        });
    }

    // Function to reset drop zone
    function resetDropZone() {
        dropZone.innerHTML = `
            <p class="text-gray-600">Drag and drop an image here or click to select</p>
            <input type="file" id="file-input" class="hidden" accept="image/*">
        `;
        // Re-initialize file input after reset
        const newFileInput = dropZone.querySelector('#file-input');
        newFileInput.addEventListener('change', handleFileInputChange);
    }

    // Function to handle file input change
    function handleFileInputChange(e) {
        const file = e.target.files[0];
        if (file) {
            handleFileUpload(file);
        }
    }

    // Function to handle drag and drop
    function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer.files[0];
        if (file) {
            handleFileUpload(file);
        }
        dropZone.classList.remove('bg-gray-100');
    }

    // Function to handle drag over
    function handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('bg-gray-100');
    }

    // Function to handle drag leave
    function handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('bg-gray-100');
    }

    // Add event listeners
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileInputChange);
    dropZone.addEventListener('dragover', handleDragOver);
    dropZone.addEventListener('dragleave', handleDragLeave);
    dropZone.addEventListener('drop', handleDrop);

    // Function to get parameters
    function getParameters() {
        return {
            depth_scale: parseFloat(document.getElementById('depth-scale').value),
            edge_weight: parseFloat(document.getElementById('edge-weight').value),
            point_density: parseInt(document.getElementById('point-density').value),
            reconstruction_method: document.getElementById('reconstruction-method').value,
            blur_amount: parseInt(document.getElementById('blur-amount').value),
            mesh_smoothing: parseInt(document.getElementById('mesh-smoothing').value),
            model_size: parseFloat(document.getElementById('model-size').value),
            crop_shape: cropShape // 'rect' or 'circle'
        };
    }

    // Function to start conversion
    function startConversion() {
        if (!currentFilename) {
            alert('Please upload an image first');
            return;
        }
        const params = getParameters();
        params.filename = currentFilename;
        showLoading(`Converting image to 3D model using ${params.reconstruction_method} method...`);
        result.classList.add('hidden');
        generateBtn.disabled = true;
        if (statusCheckInterval) {
            clearInterval(statusCheckInterval);
            statusCheckInterval = null;
        }
        fetch('/convert', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(params)
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                currentTaskId = data.task_id;
                statusCheckInterval = setInterval(() => checkConversionStatus(data.task_id), 1000);
            } else {
                throw new Error(data.error || 'Unknown error occurred');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            hideLoading();
            generateBtn.disabled = false;
            alert('Error starting conversion: ' + error.message);
        });
    }

    // Function to check conversion status (with 404 handling)
    function checkConversionStatus(taskId) {
        fetch(`/status/${taskId}`)
            .then(response => {
                if (response.status === 404) {
                    clearInterval(statusCheckInterval);
                    hideLoading();
                    generateBtn.disabled = false;
                    alert('Conversion task not found or expired.');
                    return Promise.reject('Task not found');
                }
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data.status === 'completed') {
                    clearInterval(statusCheckInterval);
                    hideLoading();
                    generateBtn.disabled = false;
                    result.classList.remove('hidden');
                    downloadLink.href = data.download_url;
                    // Try to load STL preview
                    loadSTLPreview(data.preview_url);
                } else if (data.status === 'error') {
                    clearInterval(statusCheckInterval);
                    hideLoading();
                    generateBtn.disabled = false;
                    alert('Error during conversion: ' + data.error);
                }
            })
            .catch(error => {
                if (error !== 'Task not found') {
                    clearInterval(statusCheckInterval);
                    hideLoading();
                    generateBtn.disabled = false;
                    console.error('Status check error:', error);
                    alert('Error checking conversion status: ' + (error && error.message ? error.message : error));
                }
            });
    }

    // STL Preview Loader with error handling and animation loop
    function loadSTLPreview(url) {
        const container = document.getElementById('model-viewer');
        container.innerHTML = '';
        // Use THREE.js STLLoader if available
        if (typeof THREE !== 'undefined' && typeof THREE.STLLoader !== 'undefined') {
            const loader = new THREE.STLLoader();
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
            camera.position.set(0, -10, 20);
            const renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setSize(container.clientWidth, container.clientHeight);
            container.appendChild(renderer.domElement);
            const controls = new THREE.OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;
            controls.screenSpacePanning = true;
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
            scene.add(ambientLight);
            const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
            directionalLight.position.set(1, 1, 1);
            scene.add(directionalLight);
            let mesh = null;
            loader.load(
                url,
                function (geometry) {
                    const material = new THREE.MeshPhongMaterial({ color: 0x808080, specular: 0x111111, shininess: 200, side: THREE.DoubleSide });
                    mesh = new THREE.Mesh(geometry, material);
                    scene.add(mesh);
                    // Center and fit camera
                    geometry.computeBoundingBox();
                    const center = new THREE.Vector3();
                    geometry.boundingBox.getCenter(center);
                    mesh.position.sub(center);
                    const box = new THREE.Box3().setFromObject(mesh);
                    const size = box.getSize(new THREE.Vector3());
                    const maxDim = Math.max(size.x, size.y, size.z);
                    camera.position.set(maxDim, -maxDim, maxDim);
                    camera.lookAt(0, 0, 0);
                    controls.target.set(0, 0, 0);
                    controls.update();
                },
                undefined,
                function (error) {
                    container.innerHTML = '<div class="text-red-600 text-center mt-8">Failed to load STL preview.<br>' + (error && error.message ? error.message : error) + '</div>';
                }
            );
            // Animation loop
            function animate() {
                requestAnimationFrame(animate);
                controls.update();
                renderer.render(scene, camera);
            }
            animate();
        } else {
            container.innerHTML = '<div class="text-red-600 text-center mt-8">3D preview not available (missing THREE.js or STLLoader).</div>';
        }
    }

    // Add event listener for generate button
    generateBtn.addEventListener('click', startConversion);

    // Initialize drop zone
    resetDropZone();

    // Live update slider values next to each slider
    function setupSliderValue(id) {
        const slider = document.getElementById(id);
        const valueSpan = document.getElementById(id + '-value');
        if (slider && valueSpan) {
            valueSpan.textContent = slider.value;
            slider.addEventListener('input', function() {
                valueSpan.textContent = slider.value;
            });
        }
    }
    setupSliderValue('depth-scale');
    setupSliderValue('edge-weight');
    setupSliderValue('point-density');
    setupSliderValue('blur-amount');
    setupSliderValue('mesh-smoothing');
}); 