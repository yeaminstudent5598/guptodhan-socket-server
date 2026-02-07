const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// ✅ CORS Configuration
app.use(cors({
  origin: ["https://www.guptodhandigital.com", "http://localhost:3000", "https:/guptodhandigital.com", "http://localhost:8000"], 
  methods: ["GET", "POST"],
  credentials: true
}));

const server = http.createServer(app);

// ✅ Socket.IO Server
const io = new Server(server, {
  cors: {
    origin: ["https://www.guptodhandigital.com", "http://localhost:3000", "http://localhost:8000"],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5
});

// ✅ MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI;
mongoose.connect(MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ DB Connection Error:", err.message));

// ✅ Models
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
  ad: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassifiedAd', required: true },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
}, { timestamps: true });

const Conversation = mongoose.model('Conversation', conversationSchema);

// ✅ Online Users Tracking
const onlineUsers = new Map(); // userId -> { socketId, lastSeen }
const userSockets = new Map(); // userId -> Set of socketIds
const typingUsers = new Map(); // conversationId -> Set of userIds

// ✅ Health Check
app.get('/', (req, res) => {
  res.json({
    status: '🚀 Guptodhan Socket Server is Live!',
    onlineUsers: onlineUsers.size,
    connections: io.engine.clientsCount
  });
});

// ✅ Socket Events
io.on('connection', (socket) => {
  console.log(`📡 New connection: ${socket.id}`);

  // ✅ 1. Authenticate User
  socket.on('authenticate', (userId) => {
    try {
      if (!userId) throw new Error('UserId is required');

      // Join user-specific room
      socket.join(`user_${userId}`);
      
      // Track user
      if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
      }
      userSockets.get(userId).add(socket.id);
      onlineUsers.set(userId, { socketId: socket.id, lastSeen: new Date() });
      
      console.log(`✅ User ${userId} authenticated`);
      
      // Broadcast online status
      io.emit('user_online_status', {
        userId,
        isOnline: true,
        lastSeen: new Date()
      });

      // Send back confirmation
      socket.emit('authenticated', { success: true, userId });
    } catch (error) {
      console.error('❌ Auth error:', error.message);
      socket.emit('authenticated', { success: false, error: error.message });
    }
  });

  // ✅ 2. Join Conversation Room
  socket.on('join_conversation', (data) => {
    try {
      const conversationId = data.conversationId || data;
      if (!conversationId) throw new Error('ConversationId is required');

      socket.join(`conversation_${conversationId}`);
      console.log(`💬 Socket ${socket.id} joined conversation: ${conversationId}`);
      
      socket.emit('joined_conversation', { success: true, conversationId });
    } catch (error) {
      console.error('❌ Join conversation error:', error.message);
      socket.emit('joined_conversation', { success: false, error: error.message });
    }
  });

  // ✅ 3. Send Message
  socket.on('send_message', async (data, callback) => {
    try {
      const { conversationId, senderId, receiverId, content } = data;

      if (!conversationId || !senderId || !receiverId || !content) {
        throw new Error('Missing required fields');
      }

      console.log(`📤 Message from ${senderId}: "${content}"`);

      // Verify conversation
      const conversation = await Conversation.findOne({
        _id: new mongoose.Types.ObjectId(conversationId),
        participants: { $in: [new mongoose.Types.ObjectId(senderId), new mongoose.Types.ObjectId(receiverId)] }
      });

      if (!conversation) {
        throw new Error('Conversation not found or access denied');
      }

      // Save message
      const newMessage = await Message.create({
        conversation: new mongoose.Types.ObjectId(conversationId),
        sender: new mongoose.Types.ObjectId(senderId),
        receiver: new mongoose.Types.ObjectId(receiverId),
        content,
        isRead: false
      });

      // Populate sender info
      await newMessage.populate('sender', 'name profilePicture');

      console.log(`✅ Message saved: ${newMessage._id}`);

      // Update last message
      await Conversation.findByIdAndUpdate(conversationId, { lastMessage: newMessage._id });

      // Prepare payload
      const messagePayload = {
        _id: newMessage._id,
        conversation: conversationId,
        sender: {
          _id: newMessage.sender._id,
          name: newMessage.sender.name || 'Unknown',
          profilePicture: newMessage.sender.profilePicture
        },
        receiver: new mongoose.Types.ObjectId(receiverId),
        content,
        isRead: false,
        createdAt: newMessage.createdAt
      };

      // Broadcast to conversation room
      io.to(`conversation_${conversationId}`).emit('receive_message', messagePayload);
      console.log(`📬 Message broadcast to conversation: ${conversationId}`);

      // Notify receiver if offline
      io.to(`user_${receiverId}`).emit('new_message_notification', {
        conversationId,
        senderId,
        content,
        timestamp: newMessage.createdAt
      });

      // Callback
      if (callback && typeof callback === 'function') {
        callback({ success: true, data: messagePayload });
      }
    } catch (error) {
      console.error("❌ Send message error:", error.message);
      if (callback && typeof callback === 'function') {
        callback({ success: false, error: error.message });
      }
    }
  });

  // ✅ 4. Typing Indicator
  socket.on('typing', (data) => {
    try {
      const { conversationId, userId } = data;
      if (!conversationId || !userId) return;

      if (!typingUsers.has(conversationId)) {
        typingUsers.set(conversationId, new Set());
      }
      typingUsers.get(conversationId).add(userId);

      io.to(`conversation_${conversationId}`).emit('display_typing', {
        conversationId,
        userId
      });
    } catch (error) {
      console.error('❌ Typing error:', error.message);
    }
  });

  // ✅ 5. Stop Typing
  socket.on('stop_typing', (data) => {
    try {
      const conversationId = data.conversationId || data;
      if (!conversationId) return;

      if (typingUsers.has(conversationId)) {
        typingUsers.forEach(users => users.delete(data.userId));
      }

      io.to(`conversation_${conversationId}`).emit('hide_typing', {
        conversationId,
        userId: data.userId
      });
    } catch (error) {
      console.error('❌ Stop typing error:', error.message);
    }
  });

  // ✅ 6. Check User Status
  socket.on('check_user_status', (userId, callback) => {
    try {
      const user = onlineUsers.get(userId);
      if (callback && typeof callback === 'function') {
        callback({
          isOnline: !!user,
          lastSeen: user?.lastSeen || null,
          userId
        });
      }
    } catch (error) {
      console.error('❌ Status check error:', error.message);
    }
  });

  // ✅ 7. Disconnect Handler
  socket.on('disconnect', () => {
    console.log(`❌ Socket disconnected: ${socket.id}`);

    for (let [userId, socketIds] of userSockets) {
      socketIds.delete(socket.id);

      if (socketIds.size === 0) {
        userSockets.delete(userId);
        const lastSeen = new Date();
        onlineUsers.set(userId, { socketId: null, lastSeen });

        console.log(`👤 User ${userId} went offline`);

        io.emit('user_online_status', {
          userId,
          isOnline: false,
          lastSeen
        });
      }
    }
  });

  // ✅ 8. Error Handler
  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

// ✅ Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Socket Server running on port ${PORT}`);
});