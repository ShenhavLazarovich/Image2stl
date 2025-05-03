# Image2STL: Image to 3D Relief Model Web App

This project lets you turn any image (like a coin, medallion, or logo) into a 3D printable STL relief model—right from your browser!

## Features
- Upload and crop images (rectangle or circle)
- Live preview and cropping with Cropper.js
- Adjustable parameters: depth, smoothing, blur, etc.
- Choose output size (mm)
- 3D STL preview in browser (Three.js)
- Download ready-to-print STL files
- Supports both circular and rectangular reliefs
- Fast, modern, and easy to use

## Setup
1. **Install dependencies:**
   ```sh
   pip install flask opencv-python numpy open3d pillow
   ```
2. **Run the app:**
   ```sh
   python app.py
   ```
3. **Open in your browser:**
   [http://localhost:5000](http://localhost:5000)

## Acknowledgements
- [Flask](https://flask.palletsprojects.com/)
- [OpenCV](https://opencv.org/)
- [Open3D](http://www.open3d.org/)
- [Three.js](https://threejs.org/)
- [Cropper.js](https://fengyuanchen.github.io/cropperjs/)

---

**This project was completely vibe coded.**

No overthinking, just pure creative flow and rapid iteration. Enjoy! 