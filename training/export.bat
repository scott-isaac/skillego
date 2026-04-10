@echo off
echo SkillZero Model Export (Keras -> TF.js)
echo ========================================
cd /d "%~dp0"

if not exist .venv\Scripts\python.exe (
    echo ERROR: Virtual environment not found. Run setup.bat first.
    pause
    exit /b 1
)

.venv\Scripts\python.exe -m alphazero.export %*
pause
