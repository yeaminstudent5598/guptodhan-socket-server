const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

const server = http.createServer(app);

// সকেট কনফিগারেশন
const io = new Server(server, {
  cors: {
    origin: "*", // পরে এখানে আপনার Vercel ডোমেইন দেবেন
    methods: ["GET", "POST"]
  }
});

// MongoDB কানেকশন (আপনার মেইন প্রোজেক্টের ডাটাবেস ইউআরএল ব্যবহার করুন)
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected for Socket"))
  .catch(err => console.log("❌ DB Error:", err));

const messageSchema = new mongoose.Schema({
  conversation: mongoose.Schema.Types.ObjectId,
  sender: mongoose.Schema.Types.ObjectId,
  receiver: mongoose.Schema.Types.ObjectId,
  content: String,
  isRead: { type: Boolean, default: false }
}, { timestamps: true });

const Message = mongoose.model('Message', messageSchema);

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('authenticate', (userId) => {
    socket.join(`user_${userId}`);
  });

  socket.on('join_conversation', (conversationId) => {
    socket.join(`conversation_${conversationId}`);
  });

  socket.on('send_message', async (data, callback) => {
    try {
      const { conversationId, senderId, receiverId, content } = data;
      
      const newMessage = await Message.create({
        conversation: conversationId,
        sender: senderId,
        receiver: receiverId,
        content
      });

      io.to(`conversation_${conversationId}`).emit('receive_message', newMessage);
      
      if (callback) callback({ success: true, data: newMessage });
    } catch (error) {
      if (callback) callback({ success: false, error: error.message });
    }
  });

  socket.on('disconnect', () => console.log('Disconnected'));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(` Socket Server running on port ${PORT}`));