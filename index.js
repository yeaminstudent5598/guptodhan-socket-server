const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors({
  origin: ["https://www.guptodhandigital.com", "http://localhost:3000"],
  methods: ["GET", "POST"],
  credentials: true
}));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["https://www.guptodhandigital.com", "http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ DB Error:", err.message));

// মেসেজ মডেল
const Message = mongoose.model('Message', new mongoose.Schema({
  conversation: mongoose.Schema.Types.ObjectId,
  sender: mongoose.Schema.Types.ObjectId,
  receiver: mongoose.Schema.Types.ObjectId,
  content: String,
}, { timestamps: true }));

app.get('/', (req, res) => res.send('🚀 Socket Server Live!'));

io.on('connection', (socket) => {
  socket.on('authenticate', (userId) => socket.join(`user_${userId}`));
  socket.on('join_conversation', (cid) => socket.join(`conversation_${cid}`));

  // ✅ টাইপিং ইভেন্টসমূহ
  socket.on('typing', (data) => {
    socket.to(`conversation_${data.conversationId}`).emit('display_typing', data);
  });

  socket.on('stop_typing', (data) => {
    socket.to(`conversation_${data.conversationId}`).emit('hide_typing', data);
  });

  socket.on('send_message', async (data, callback) => {
    try {
      const msg = await Message.create({
        conversation: data.conversationId,
        sender: data.senderId,
        receiver: data.receiverId,
        content: data.content
      });
      io.to(`conversation_${data.conversationId}`).emit('receive_message', msg);
      if (callback) callback({ success: true, data: msg });
    } catch (error) {
      if (callback) callback({ success: false, error: error.message });
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));