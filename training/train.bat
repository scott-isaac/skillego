@echo off
echo SkillZero Training
echo ==================
cd /d "%~dp0"

if not exist .venv\Scripts\python.exe (
    echo ERROR: Virtual environment not found. Run setup.bat first.
    pause
    exit /b 1
)

.venv\Scripts\python.exe -u -m alphazero.train %*
pause
