const express = require('express');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = 3000;
const HOST = 'localhost';

// Раздача статических файлов (HTML, CSS, JS)
app.use(express.static(path.join(__dirname)));

// Возвращаем index_final.html при обращении к корневому URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});



// Обновить состояние задвижки
app.post('/api/gates/:id', express.json(), (req, res) => {
  const { id } = req.params;
  const { state } = req.body;



  if (gates[id] !== undefined) {
    gates[id] = state;

    // Уведомляем все подключённые клиенты через WebSocket
    broadcast({ type: 'update', gateId: id, state });

    res.json({ message: `Gate ${id} updated to ${state}` });
  } else {
    res.status(404).json({ error: 'Gate not found' });
  }
});

// Запуск сервера
const server = app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}/`);
});
