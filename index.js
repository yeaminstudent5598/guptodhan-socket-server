const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// ✅ 1. CORS Configuration (Typo Fixed & Optimized)
const allowedOrigins = [
  "https://guptodhandigital.com",      // Main Domain
  "https://www.guptodhandigital.com",  // WWW Domain
  "http://localhost:3000",             // Localhost
  "http://127.0.0.1:3000"              // IP Localhost
];

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST"],
  credentials: true
}));

const server = http.createServer(app);

// ✅ 2. Socket.IO Server (Optimized Configuration)
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'], // WebSocket First
  path: '/socket.io/', // Nginx Matching Path
  reconnection: true,
  pingTimeout: 60000, // Connection stability update
});

// ✅ 3. MongoDB Connection (Local VPS DB)
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/guptodhan?ssl=false&directConnection=true";

mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,
})
  .then(() => console.log("✅ Socket Server MongoDB Connected (Fast Mode)"))
  .catch(err => {
    console.error("❌ DB Connection Error:", err.message);
    process.exit(1);
  });

// ✅ 4. Minimal Schemas (No Hooks, Pure Data)
const userSchema = new mongoose.Schema({
  name: String,
  profilePicture: String,
  email: String,
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  content: { type: String, required: true },
  isRead: { type: Boolean, default: false }
}, { timestamps: true });

const Message = mongoose.model('Message', messageSchema);

const conversationSchema = new mongoose.Schema({
  ad: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassifiedAd' },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
}, { timestamps: true });

const Conversation = mongoose.model('Conversation', conversationSchema);

// ✅ 5. In-Memory State Management (Redis Alternative)
const onlineUsers = new Map(); // userId -> { socketId, lastSeen }
const userSockets = new Map(); // userId -> Set of socketIds

// ✅ 6. Socket Events
io.on('connection', (socket) => {
  console.log(`📡 Connected: ${socket.id}`);

  // 🔹 Authenticate & Track User
  socket.on('authenticate', (userId) => {
    if (!userId) return;

    socket.join(`user_${userId}`);
    
    if (!userSockets.has(userId)) userSockets.set(userId, new Set());
    userSockets.get(userId).add(socket.id);
    onlineUsers.set(userId, { socketId: socket.id, lastSeen: new Date() });
    
    io.emit('user_online_status', { userId, isOnline: true, lastSeen: new Date() });
    socket.emit('authenticated', { success: true, userId });
  });

  // 🔹 Join Conversation Room
  socket.on('join_conversation', ({ conversationId }) => {
    if (conversationId) {
      socket.join(`conversation_${conversationId}`);
      socket.emit('joined_conversation', { success: true, conversationId });
    }
  });

  // 🔹 Send Message (🚀 OPTIMIZED: Using Aggregation instead of Populate)
  socket.on('send_message', async (data, callback) => {
    try {
      const { conversationId, senderId, receiverId, content } = data;

      if (!conversationId || !senderId || !receiverId || !content) {
        throw new Error('Missing required fields');
      }

      // ১. মেসেজ ডাটাবেসে সেভ করা (Fast Write)
      const newMessage = await Message.create({
        conversation: new mongoose.Types.ObjectId(conversationId),
        sender: new mongoose.Types.ObjectId(senderId),
        receiver: new mongoose.Types.ObjectId(receiverId),
        content,
        isRead: false
      });

      // ২. Conversation আপডেট করা (Async - Don't wait for it)
      Conversation.findByIdAndUpdate(conversationId, { lastMessage: newMessage._id }).exec();

      // ৩. 🚀 SUPER FAST AGGREGATION LOOKUP (No Populate)
      // ডাটাবেস লেভেলে জয়েন করে Sender এর নাম আর ছবি আনছি
      const messageWithSender = await Message.aggregate([
        { $match: { _id: newMessage._id } },
        {
          $lookup: {
            from: 'users', // Collection name in DB
            localField: 'sender',
            foreignField: '_id',
            as: 'senderInfo'
          }
        },
        { $unwind: '$senderInfo' },
        {
          $project: {
            _id: 1,
            conversation: 1,
            receiver: 1,
            content: 1,
            isRead: 1,
            createdAt: 1,
            // Sender Object Structure
            sender: {
              _id: '$senderInfo._id',
              name: '$senderInfo.name',
              profilePicture: '$senderInfo.profilePicture'
            }
          }
        }
      ]);

      const payload = messageWithSender[0];

      if (!payload) throw new Error('Failed to fetch message details');

      console.log(`📤 Sent: ${payload._id}`);

      // ৪. Broadcast Message
      io.to(`conversation_${conversationId}`).emit('receive_message', payload);
      
      // ৫. Notification to Receiver
      io.to(`user_${receiverId}`).emit('new_message_notification', {
        conversationId,
        senderId,
        content,
        timestamp: payload.createdAt
      });

      if (callback) callback({ success: true, data: payload });

    } catch (error) {
      console.error("❌ Send Error:", error.message);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  // 🔹 Typing Indicators
  socket.on('typing', ({ conversationId, userId }) => {
    if (conversationId && userId) {
      socket.to(`conversation_${conversationId}`).emit('display_typing', { conversationId, userId });
    }
  });

  socket.on('stop_typing', ({ conversationId, userId }) => {
    if (conversationId && userId) {
      socket.to(`conversation_${conversationId}`).emit('hide_typing', { conversationId, userId });
    }
  });

  // 🔹 Check Status
  socket.on('check_user_status', (userId, callback) => {
    const user = onlineUsers.get(userId);
    if (callback) callback({ isOnline: !!user, lastSeen: user?.lastSeen || null, userId });
  });

  // 🔹 Disconnect
  socket.on('disconnect', () => {
    for (let [userId, socketIds] of userSockets) {
      socketIds.delete(socket.id);
      if (socketIds.size === 0) {
        userSockets.delete(userId);
        const lastSeen = new Date();
        onlineUsers.set(userId, { socketId: null, lastSeen });
        io.emit('user_online_status', { userId, isOnline: false, lastSeen });
      }
    }
  });
});

// ✅ 7. Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Socket Server running on port ${PORT}`);
});