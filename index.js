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

// ২. সকেট সার্ভার
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
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ DB Connection Error:", err.message));

// ৪. ✅ User Schema এবং Model (ADDED)
const userSchema = new mongoose.Schema({
  name: String,
  profilePicture: String,
  email: String,
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

// ৫. Message মডেল
const messageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  content: { type: String, required: true },
  isRead: { type: Boolean, default: false }
}, { timestamps: true });

const Message = mongoose.model('Message', messageSchema);

// ৬. Conversation মডেল
const conversationSchema = new mongoose.Schema({
  ad: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassifiedAd', required: true },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
}, { timestamps: true });

const Conversation = mongoose.model('Conversation', conversationSchema);

// ৭. অনলাইন ইউজার ট্র্যাক করা
const onlineUsers = new Map(); // userId -> { socketId, lastSeen }
const userSockets = new Map(); // userId -> Set of socketIds

// ৮. হেলথ চেক
app.get('/', (req, res) => {
  res.send('🚀 Guptodhan Socket Server is Live!');
});

// ৯. সকেট ইভেন্ট
io.on('connection', (socket) => {
  console.log(`📡 New connection: ${socket.id}`);

  // ✅ ইউজার authenticate করা
  socket.on('authenticate', (userId) => {
    if (userId) {
      socket.join(`user_${userId}`);
      
      // ইউজার অনলাইন করা
      if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
      }
      userSockets.get(userId).add(socket.id);
      onlineUsers.set(userId, { socketId: socket.id, lastSeen: new Date() });
      
      console.log(`👤 User ${userId} authenticated (${userSockets.get(userId).size} connections)`);
      
      // সবাইকে অনলাইন স্ট্যাটাস পাঠান
      io.emit('user_online_status', {
        userId,
        isOnline: true,
        lastSeen: new Date()
      });
    }
  });

  // ✅ Conversation এ join করা
  socket.on('join_conversation', (conversationId) => {
    if (conversationId) {
      socket.join(`conversation_${conversationId}`);
      console.log(`💬 Socket joined conversation: ${conversationId}`);
    }
  });

  // ✅ মেসেজ পাঠানো (Bikroy.com এর মতো)
  socket.on('send_message', async (data, callback) => {
    try {
      const { conversationId, senderId, receiverId, content } = data;

      console.log(`📤 Message: "${content}" from ${senderId} to ${receiverId}`);

      // ✅ Conversation verify করা
      const conversation = await Conversation.findOne({
        _id: new mongoose.Types.ObjectId(conversationId),
        participants: { $in: [senderId, receiverId] }
      });

      if (!conversation) {
        throw new Error('Conversation not found or access denied');
      }

      // ✅ Message save করা
      const newMessage = await Message.create({
        conversation: new mongoose.Types.ObjectId(conversationId),
        sender: new mongoose.Types.ObjectId(senderId),
        receiver: new mongoose.Types.ObjectId(receiverId),
        content,
        isRead: false
      });

      // ✅ Sender information populate করা
      await newMessage.populate('sender', 'name profilePicture');

      console.log(`✅ Message saved: ${newMessage._id}`);

      // ✅ Last message update করা
      await Conversation.findByIdAndUpdate(
        conversationId,
        { lastMessage: newMessage._id },
        { new: true }
      );

      // ✅ Conversation এর সবাইকে message পাঠানো
      const messagePayload = {
        _id: newMessage._id,
        conversation: conversationId,
        sender: {
          _id: senderId,
          name: newMessage.sender?.name || 'Unknown',
          profilePicture: newMessage.sender?.profilePicture
        },
        receiver: new mongoose.Types.ObjectId(receiverId),
        content,
        isRead: false,
        createdAt: newMessage.createdAt
      };

      io.to(`conversation_${conversationId}`).emit('receive_message', messagePayload);
      console.log(`📬 Broadcast to conversation: ${conversationId}`);

      // ✅ Receiver কে notification পাঠানো (যদি conversation এ না থাকে)
      io.to(`user_${receiverId}`).emit('new_message_notification', {
        conversationId,
        senderId,
        senderName: newMessage.sender?.name || 'Unknown',
        content,
        timestamp: newMessage.createdAt
      });

      // ✅ Callback
      if (callback) {
        callback({ success: true, data: messagePayload });
      }

    } catch (error) {
      console.error("❌ Error:", error.message);
      if (callback) {
        callback({ success: false, error: error.message });
      }
    }
  });

  // ✅ ইউজার অনলাইন স্ট্যাটাস চেক করা
  socket.on('check_user_status', (userId, callback) => {
    const user = onlineUsers.get(userId);
    if (callback) {
      callback({
        isOnline: !!user,
        lastSeen: user?.lastSeen || null
      });
    }
  });

  // ✅ সমস্ত অনলাইন ইউজার পাওয়া
  socket.on('get_online_users', (callback) => {
    const onlineList = Array.from(onlineUsers.entries()).map(([userId, data]) => ({
      userId,
      lastSeen: data.lastSeen
    }));
    if (callback) callback(onlineList);
  });

  // ✅ Disconnect হওয়া
  socket.on('disconnect', () => {
    console.log(`❌ Socket disconnected: ${socket.id}`);

    // সব ইউজারকে চেক করা
    for (let [userId, socketIds] of userSockets) {
      socketIds.delete(socket.id);
      
      if (socketIds.size === 0) {
        userSockets.delete(userId);
        const lastSeen = new Date();
        onlineUsers.set(userId, { socketId: null, lastSeen });

        console.log(`👤 User ${userId} went offline`);

        // সবাইকে অফলাইন স্ট্যাটাস পাঠানো
        io.emit('user_online_status', {
          userId,
          isOnline: false,
          lastSeen
        });
      }
    }
  });
});

// ১০. সার্ভার চালু করা
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Socket Server running on port ${PORT}`);
});