@echo off
rem باز کردن پورت برنامه روی شبکه (فقط شبکه‌های Private/Domain)
rem اگر دسترسی ادمین لازم باشد، خودش پنجرهٔ تأیید را نشان می‌دهد.
setlocal
set PORT=8787
if not "%1"=="" set PORT=%1

net session >nul 2>nul
if %errorlevel% neq 0 (
  echo درخواست دسترسی مدیریتی...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%PORT%' -Verb RunAs"
  exit /b
)

netsh advfirewall firewall show rule name="GhazaPors Directory" >nul 2>nul
if %errorlevel%==0 netsh advfirewall firewall delete rule name="GhazaPors Directory" >nul

netsh advfirewall firewall add rule name="GhazaPors Directory" dir=in action=allow protocol=TCP localport=%PORT% profile=private,domain
echo.
echo  قاعدهٔ فایروال برای پورت %PORT% اضافه شد. حالا همکاران می‌توانند وصل شوند.
echo  (برای حذف: netsh advfirewall firewall delete rule name="GhazaPors Directory")
pause
endlocal
