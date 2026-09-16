@echo off
title BILIRAN-GIS GitHub Sync

cd /d C:\Users\Pc\Documents\THESIS_PROJECT

echo ========================================
echo       BILIRAN-GIS GitHub Sync
echo ========================================
echo.

echo Checking for changes...
git status

echo.
echo Adding all changes...
git add .

echo.
echo Checking if there is anything to commit...

git diff --cached --quiet

if %errorlevel%==0 (
    echo.
    echo No changes to commit.
) else (
    echo.
    echo Committing changes...
    git commit -m "Update BILIRAN-GIS project"
)

echo.
echo Pushing to GitHub...
echo.

git push

echo.
echo ========================================
echo             SYNC COMPLETE
echo ========================================
pause