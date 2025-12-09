# Download face-api.js models
$modelUrl = "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights"
$outputDir = "public/models"

# Create output directory if it doesn't exist
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

# Models to download
$models = @(
    # SSD MobileNet v1 - Face detection
    "ssd_mobilenetv1_model-weights_manifest.json",
    "ssd_mobilenetv1_model-shard1",
    "ssd_mobilenetv1_model-shard2",
    
    # Tiny Face Detector - Fast face detection
    "tiny_face_detector_model-weights_manifest.json",
    "tiny_face_detector_model-shard1",
    
    # Face Landmark 68 - Facial landmarks
    "face_landmark_68_model-weights_manifest.json",
    "face_landmark_68_model-shard1",
    
    # Face Recognition - Face descriptor/embedding
    "face_recognition_model-weights_manifest.json",
    "face_recognition_model-shard1",
    "face_recognition_model-shard2"
)

Write-Host "Downloading face-api.js models to $outputDir..." -ForegroundColor Cyan

foreach ($model in $models) {
    $url = "$modelUrl/$model"
    $output = "$outputDir/$model"
    
    Write-Host "  Downloading $model..." -ForegroundColor Yellow
    try {
        Invoke-WebRequest -Uri $url -OutFile $output -UseBasicParsing
        Write-Host "    OK" -ForegroundColor Green
    } catch {
        Write-Host "    FAILED: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Done! Models downloaded to $outputDir" -ForegroundColor Green
Write-Host "You can now run 'npm run dev' and use AI-powered face detection." -ForegroundColor Cyan

