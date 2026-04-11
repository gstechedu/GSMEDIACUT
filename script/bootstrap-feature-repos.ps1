$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$vendorRoot = Join-Path $repoRoot "vendor"

$repos = @(
  @{
    Name = "OpenCut"
    Url = "https://github.com/OpenCut-app/OpenCut"
  },
  @{
    Name = "lottie-web"
    Url = "https://github.com/airbnb/lottie-web"
  },
  @{
    Name = "lottie-react"
    Url = "https://github.com/LottieFiles/lottie-react"
  },
  @{
    Name = "Lottie-Windows"
    Url = "https://github.com/CommunityToolkit/Lottie-Windows"
  },
  @{
    Name = "gl-transitions"
    Url = "https://github.com/gl-transitions/gl-transitions"
  },
  @{
    Name = "ffmpeg-gl-transition"
    Url = "https://github.com/transitive-bullshit/ffmpeg-gl-transition"
  },
  @{
    Name = "RIFE"
    Url = "https://github.com/hzwer/ECCV2022-RIFE"
  },
  @{
    Name = "RobustVideoMatting"
    Url = "https://github.com/PeterL1n/RobustVideoMatting"
  },
  @{
    Name = "Theatre"
    Url = "https://github.com/theatre-js/theatre"
  },
  @{
    Name = "vid.stab"
    Url = "https://github.com/georgmartius/vid.stab"
  },
  @{
    Name = "whisper.cpp"
    Url = "https://github.com/ggml-org/whisper.cpp"
  },
  @{
    Name = "Remotion"
    Url = "https://github.com/remotion-dev/remotion"
  },
  @{
    Name = "PyCaps"
    Url = "https://github.com/francozanardi/pycaps"
  },
  @{
    Name = "ScriptGen"
    Url = "https://github.com/LebToki/ScriptGen"
  },
  @{
    Name = "twick"
    Url = "https://github.com/ncounterspecialist/twick"
  },
  @{
    Name = "WatermarkRemover-AI"
    Url = "https://github.com/D-Ogi/WatermarkRemover-AI"
  },
  @{
    Name = "VeoWatermarkRemover"
    Url = "https://github.com/allenk/VeoWatermarkRemover"
  }
)

New-Item -ItemType Directory -Force -Path $vendorRoot | Out-Null

foreach ($repo in $repos) {
  $target = Join-Path $vendorRoot $repo.Name

  if (Test-Path $target) {
    Write-Host "Updating $($repo.Name)..."
    git -C $target pull --ff-only
  } else {
    Write-Host "Cloning $($repo.Name)..."
    git clone --depth 1 $repo.Url $target
  }
}

Write-Host ""
Write-Host "Vendor repos are ready in $vendorRoot"
