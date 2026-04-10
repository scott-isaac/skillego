@echo off
echo Setting up SkillZero training environment...
cd /d "%~dp0"

if not exist .venv (
    echo Creating virtual environment...
    python -m venv .venv
)

echo Installing dependencies...
.venv\Scripts\pip.exe install -r requirements.txt

echo.
echo Setup complete. Run: train.bat
