const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// ১. CORS কনফিগারেশন (আপনার Vercel ডোমেইন এলাউ করার জন্য)
app.use(cors({
  origin: ["https://www.guptodhandigital.com", "http://localhost:3000"],
  methods: ["GET", "POST"],
  credentials: true
}));

const server = http.createServer(app);

// ২. সকেট সার্ভার ইনিশিয়ালাইজেশন
const io = new Server(server, {
  cors: {
    origin: ["https://www.guptodhandigital.com", "http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// ৩. MongoDB কানেকশন
const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected successfully for Socket"))
  .catch(err => console.error("❌ DB Connection Error:", err.message));

// ৪. মেসেজ মডেল (সরাসরি মেইন ডাটাবেসে সেভ করার জন্য)
const messageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  content: { type: String, required: true },
  isRead: { type: Boolean, default: false }
}, { timestamps: true });

const Message = mongoose.model('Message', messageSchema);

// ৫. হেলথ চেক রুট (ব্রাউজারে চেক করার জন্য)
app.get('/', (req, res) => {
  res.send('🚀 Guptodhan Real-time Chat Server is Live!');
});

// ৬. সকেট ইভেন্ট হ্যান্ডলিং
io.on('connection', (socket) => {
  console.log(`📡 New connection: ${socket.id}`);

  // ইউজারকে তার নিজস্ব রুমে জয়েন করানো (ব্যক্তিগত নোটিফিকেশনের জন্য)
  socket.on('authenticate', (userId) => {
    if (userId) {
      socket.join(`user_${userId}`);
      console.log(`👤 User joined room: user_${userId}`);
    }
  });

  // নির্দিষ্ট কনভারসেশন রুমে জয়েন করা
  socket.on('join_conversation', (conversationId) => {
    if (conversationId) {
      socket.join(`conversation_${conversationId}`);
      console.log(`💬 Joined conversation room: ${conversationId}`);
    }
  });

  // মেসেজ পাঠানো এবং সেভ করা
  socket.on('send_message', async (data, callback) => {
    try {
      const { conversationId, senderId, receiverId, content } = data;

      // ডাটাবেসে মেসেজ সেভ
      const newMessage = await Message.create({
        conversation: conversationId,
        sender: senderId,
        receiver: receiverId,
        content: content
      });

      // রুমে থাকা সবাইকে রিয়েল-টাইমে মেসেজ পাঠানো
      io.to(`conversation_${conversationId}`).emit('receive_message', newMessage);
      
      // রিসিভারকে গ্লোবাল নোটিফিকেশন পাঠানো (যদি সে অন্য রুমে থাকে)
      io.to(`user_${receiverId}`).emit('new_notification', {
        type: 'message',
        conversationId
      });

      // সাকসেস কলব্যাক
      if (callback) callback({ success: true, data: newMessage });

    } catch (error) {
      console.error("❌ Message save error:", error.message);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected');
  });
});

// ৭. সার্ভার পোর্ট সেটআপ
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Socket Server is running on port ${PORT}`);
});