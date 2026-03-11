npm run preview -- --port 5173 --host &
PID=$!
sleep 5
curl -k -s https://localhost:5173 > /dev/null && echo "Ready!" || echo "Failed!"
kill $PID
