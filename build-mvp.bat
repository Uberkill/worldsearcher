@echo off
echo ==============================================
echo   Building World Searcher MVP for Production
echo ==============================================
echo.
echo Running Vite build process...
call npm run build

echo.
echo ==============================================
echo   Build Complete!
echo ==============================================
echo Your production-ready files are in the "dist" folder.
echo You can upload the "dist" folder to any static web host.
echo.
echo If you want to preview the production build locally, 
echo run "npx vite preview" in your terminal.
echo.
pause
