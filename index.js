const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// ১. CORS কনফিগারেশন
app.use(cors({
  origin: ["https://www.guptodhandigital.com", "http://localhost:3000"],
  methods: ["GET", "POST"],
  credentials: true
}));

const server = http.createServer(app);

// ২. সকেট সার্ভার ইনিশিয়ালাইজেশন
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

// ৪. মেসেজ মডেল
const messageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  content: { type: String, required: true },
  isRead: { type: Boolean, default: false }
}, { timestamps: true });

const Message = mongoose.model('Message', messageSchema);

// ৫. ইউজার অনলাইন স্ট্যাটাস ট্র্যাক করার জন্য
const onlineUsers = new Map();

// ৬. হেলথ চেক রুট
app.get('/', (req, res) => {
  res.send('🚀 Guptodhan Real-time Chat Server is Live!');
});

// ৭. সকেট ইভেন্ট হ্যান্ডলিং
io.on('connection', (socket) => {
  console.log(`📡 New connection: ${socket.id}`);

  // ইউজারকে তার নিজস্ব রুমে জয়েন করানো
  socket.on('authenticate', (userId) => {
    if (userId) {
      socket.join(`user_${userId}`);
      onlineUsers.set(userId, { socketId: socket.id, lastSeen: new Date() });
      console.log(`👤 User authenticated: ${userId}`);
      console.log(`📊 Online users count: ${onlineUsers.size}`);
      
      // সবাইকে বলুন যে এই ইউজার অনলাইন এসেছে
      io.emit('user_online_status', {
        userId,
        isOnline: true,
        lastSeen: new Date()
      });
    }
  });

  // নির্দিষ্ট কনভারসেশন রুমে জয়েন করা
  socket.on('join_conversation', (conversationId) => {
    if (conversationId) {
      socket.join(`conversation_${conversationId}`);
      console.log(`💬 Socket ${socket.id} joined conversation room: conversation_${conversationId}`);
    }
  });

  // মেসেজ পাঠানো এবং সেভ করা
  socket.on('send_message', async (data, callback) => {
    try {
      const { conversationId, senderId, receiverId, content } = data;

      console.log(`📤 Message from ${senderId} to ${receiverId}:`);
      console.log(`   Content: ${content}`);
      console.log(`   Conversation: ${conversationId}`);

      // ✅ ডাটাবেসে মেসেজ সেভ করার সময় receiver এর lastSeen আপডেট করা
      const newMessage = await Message.create({
        conversation: conversationId,
        sender: senderId,
        receiver: receiverId,
        content: content,
        isRead: false
      });

      // ✅ মেসেজ populate করে পাঠান (sender info সহ)
      const populatedMessage = await newMessage.populate('sender', 'name profilePicture');

      console.log(`✅ Message saved with ID: ${newMessage._id}`);

      // ✅ কনভারসেশন রুমে থাকা সবাইকে রিয়েল-টাইমে মেসেজ পাঠানো
      io.to(`conversation_${conversationId}`).emit('receive_message', {
        _id: newMessage._id,
        conversation: conversationId,
        sender: {
          _id: senderId,
          name: populatedMessage.sender?.name || 'Unknown'
        },
        receiver: receiverId,
        content: content,
        isRead: false,
        createdAt: newMessage.createdAt
      });

      console.log(`📬 Message broadcast to room: conversation_${conversationId}`);

      // ✅ রিসিভারকে গ্লোবাল নোটিফিকেশন পাঠানো (যদি সে কনভারসেশনে না থাকে)
      io.to(`user_${receiverId}`).emit('new_message_notification', {
        type: 'message',
        conversationId,
        senderId,
        senderName: populatedMessage.sender?.name || 'Unknown',
        content: content,
        timestamp: newMessage.createdAt
      });

      console.log(`🔔 Notification sent to user: ${receiverId}`);

      // ✅ সাকসেস কলব্যাক
      if (callback) {
        callback({ 
          success: true, 
          data: newMessage,
          message: 'Message sent successfully'
        });
      }

    } catch (error) {
      console.error("❌ Message save error:", error.message);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  // ✅ ডিসকানেক্ট করার সময় ইউজার অফলাইন করা
  socket.on('disconnect', () => {
    console.log(`❌ Socket disconnected: ${socket.id}`);
    
    // অনলাইন ইউজার থেকে খুঁজে বের করুন এবং রিমুভ করুন
    let disconnectedUserId = null;
    for (let [userId, data] of onlineUsers) {
      if (data.socketId === socket.id) {
        disconnectedUserId = userId;
        onlineUsers.delete(userId);
        break;
      }
    }

    if (disconnectedUserId) {
      const now = new Date();
      console.log(`👤 User ${disconnectedUserId} went offline at ${now}`);
      
      // সবাইকে বলুন যে এই ইউজার অফলাইন হয়েছে
      io.emit('user_online_status', {
        userId: disconnectedUserId,
        isOnline: false,
        lastSeen: now
      });
    }

    console.log(`📊 Online users count: ${onlineUsers.size}`);
  });

  // ✅ ইউজার অনলাইন স্ট্যাটাস চেক করার জন্য
  socket.on('check_user_status', (userId, callback) => {
    const user = onlineUsers.get(userId);
    if (user) {
      if (callback) callback({
        isOnline: true,
        lastSeen: user.lastSeen
      });
    } else {
      if (callback) callback({
        isOnline: false,
        lastSeen: null
      });
    }
  });

  // ✅ সমস্ত অনলাইন ইউজার পাওয়ার জন্য
  socket.on('get_online_users', (callback) => {
    const onlineUsersList = Array.from(onlineUsers.entries()).map(([userId, data]) => ({
      userId,
      lastSeen: data.lastSeen
    }));
    if (callback) callback(onlineUsersList);
  });
});

// ৮. সার্ভার পোর্ট সেটআপ
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Socket Server is running on port ${PORT}`);
  console.log(`🔗 CORS enabled for: ${process.env.VERCEL_URL || 'http://localhost:3000'}`);
});