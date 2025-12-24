const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

const server = http.createServer(app);

// সকেট কনফিগারেশন (Standalone Server এর জন্য path দরকার নেই, ডিফল্ট থাকবে)
const io = new Server(server, {
  cors: {
    origin: "https://www.guptodhandigital.com", // আপনার Vercel ডোমেইন পরে এখানে দিতে পারেন
    methods: ["GET", "POST"]
  }
});

// MongoDB কানেকশন
const dbUri = process.env.MONGODB_URI;

mongoose.connect(dbUri)
  .then(() => console.log("✅ MongoDB Connected successfully for Socket"))
  .catch(err => console.log("❌ DB Error Details:", err.message));

// মেসেজ স্কিমা (ডাটাবেসে মেসেজ সেভ করার জন্য)
const messageSchema = new mongoose.Schema({
  conversation: mongoose.Schema.Types.ObjectId,
  sender: mongoose.Schema.Types.ObjectId,
  receiver: mongoose.Schema.Types.ObjectId,
  content: String,
  isRead: { type: Boolean, default: false }
}, { timestamps: true });

const Message = mongoose.model('Message', messageSchema);

// সকেট ইভেন্ট হ্যান্ডেলার
io.on('connection', (socket) => {
  console.log(`📡 New User Connected: ${socket.id}`);

  socket.on('authenticate', (userId) => {
    socket.join(`user_${userId}`);
    console.log(`👤 User ${userId} is now online`);
  });

  socket.on('join_conversation', (conversationId) => {
    socket.join(`conversation_${conversationId}`);
    console.log(`💬 Joined Room: ${conversationId}`);
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

      // রুমে থাকা সবাইকে মেসেজ পাঠানো
      io.to(`conversation_${conversationId}`).emit('receive_message', newMessage);
      
      // ✅ কলব্যাক পাঠানো জরুরি (Timeout এরর বন্ধ করতে)
      if (callback) callback({ success: true, data: newMessage });

    } catch (error) {
      console.error("Save Error:", error.message);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ User Disconnected');
  });
});

app.get('/', (req, res) => {
  res.send('🚀 Socket Server is running perfectly!');
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Socket Server running on port ${PORT}`));