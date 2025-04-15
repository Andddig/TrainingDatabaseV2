# Create directories if they don't exist
New-Item -ItemType Directory -Force -Path "public/js"
New-Item -ItemType Directory -Force -Path "public/css"
New-Item -ItemType Directory -Force -Path "public/webfonts"

# JavaScript files
$jsFiles = @{
    "jquery.min.js" = "https://code.jquery.com/jquery-3.6.0.min.js"
    "bootstrap.bundle.min.js" = "https://cdn.jsdelivr.net/npm/bootstrap@4.6.2/dist/js/bootstrap.bundle.min.js"
    "sortable.min.js" = "https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js"
}

# CSS files
$cssFiles = @{
    "bootstrap.min.css" = "https://cdn.jsdelivr.net/npm/bootstrap@4.6.2/dist/css/bootstrap.min.css"
    "font-awesome.min.css" = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
}

# Font Awesome webfonts
$webfonts = @(
    "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2",
    "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.ttf",
    "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff",
    "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2",
    "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.ttf",
    "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff"
)

# Download JavaScript files
foreach ($file in $jsFiles.GetEnumerator()) {
    Write-Host "Downloading $($file.Key)..."
    Invoke-WebRequest -Uri $file.Value -OutFile "public/js/$($file.Key)"
}

# Download CSS files
foreach ($file in $cssFiles.GetEnumerator()) {
    Write-Host "Downloading $($file.Key)..."
    Invoke-WebRequest -Uri $file.Value -OutFile "public/css/$($file.Key)"
}

# Download webfonts
foreach ($fontUrl in $webfonts) {
    $fileName = $fontUrl.Split('/')[-1]
    Write-Host "Downloading $fileName..."
    Invoke-WebRequest -Uri $fontUrl -OutFile "public/webfonts/$fileName"
}

Write-Host "All files downloaded successfully!" 