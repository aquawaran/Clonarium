const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Конфигурация
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'clone-secret-key-2024';
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Создание папок
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOAD_DIR));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 100 // лимит запросов
});
app.use('/api/', limiter);

// Настройка Multer для загрузки файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const userFolder = path.join(UPLOAD_DIR, req.user.id);
        if (!fs.existsSync(userFolder)) {
            fs.mkdirSync(userFolder, { recursive: true });
        }
        cb(null, userFolder);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|mp4|avi|mov/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Только изображения и видео разрешены!'));
        }
    }
});

// База данных в памяти (для демо)
let users = [];
let posts = [];
let followers = {}; // кто на кого подписан
let notifications = [];

// Middleware для проверки JWT токена
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Токен не предоставлен' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Неверный токен' });
        }
        req.user = user;
        next();
    });
};

// Socket.IO подключение
const connectedUsers = new Map();

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);

    socket.on('authenticate', (token) => {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            connectedUsers.set(decoded.id, socket.id);
            socket.userId = decoded.id;
            console.log(`Пользователь ${decoded.id} аутентифицирован`);
        } catch (err) {
            socket.disconnect();
        }
    });

    socket.on('disconnect', () => {
        if (socket.userId) {
            connectedUsers.delete(socket.userId);
        }
        console.log('Пользователь отключился:', socket.id);
    });
});

// Функция отправки уведомлений
const sendNotification = (userId, notification) => {
    const socketId = connectedUsers.get(userId);
    if (socketId) {
        io.to(socketId).emit('notification', notification);
    }
    
    notifications.push({
        id: uuidv4(),
        userId,
        ...notification,
        createdAt: new Date().toISOString()
    });
};

// API Routes

// Регистрация
app.post('/api/register', async (req, res) => {
    try {
        const { name, username, email, password } = req.body;

        // Валидация
        if (!name || !username || !email || !password) {
            return res.status(400).json({ error: 'Все поля обязательны' });
        }

        if (username.length < 4) {
            return res.status(400).json({ error: 'Username должен содержать минимум 4 символа' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Пароль должен содержать минимум 8 символов' });
        }

        // Проверка уникальности
        if (users.some(u => u.email === email)) {
            return res.status(400).json({ error: 'Пользователь с такой почтой уже существует' });
        }

        if (users.some(u => u.username === username)) {
            return res.status(400).json({ error: 'Этот username уже занят' });
        }

        // Хеширование пароля
        const hashedPassword = await bcrypt.hash(password, 10);

        // Создание пользователя
        const newUser = {
            id: uuidv4(),
            name,
            username,
            email,
            password: hashedPassword,
            avatar: null,
            bio: '',
            createdAt: new Date().toISOString()
        };

        users.push(newUser);

        // Создание токена
        const token = jwt.sign({ id: newUser.id, email: newUser.email }, JWT_SECRET);

        res.status(201).json({
            message: 'Регистрация успешна',
            token,
            user: {
                id: newUser.id,
                name: newUser.name,
                username: newUser.username,
                email: newUser.email,
                avatar: newUser.avatar,
                bio: newUser.bio
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Вход
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email и пароль обязательны' });
        }

        // Поиск пользователя
        const user = users.find(u => u.email === email);
        if (!user) {
            return res.status(401).json({ error: 'Неверная почта или пароль' });
        }

        // Проверка пароля
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Неверная почта или пароль' });
        }

        // Создание токена
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);

        res.json({
            message: 'Вход выполнен успешно',
            token,
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                email: user.email,
                avatar: user.avatar,
                bio: user.bio
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение текущего пользователя
app.get('/api/me', authenticateToken, (req, res) => {
    const user = users.find(u => u.id === req.user.id);
    if (!user) {
        return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json({
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        bio: user.bio
    });
});

// Обновление профиля
app.put('/api/profile', authenticateToken, async (req, res) => {
    try {
        const { name, username, bio } = req.body;
        const user = users.find(u => u.id === req.user.id);

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        // Валидация
        if (username && username.length < 4) {
            return res.status(400).json({ error: 'Username должен содержать минимум 4 символа' });
        }

        // Проверка уникальности username
        if (username && username !== user.username && 
            users.some(u => u.username === username && u.id !== user.id)) {
            return res.status(400).json({ error: 'Этот username уже занят' });
        }

        // Обновление данных
        if (name) user.name = name;
        if (username) user.username = username;
        if (bio !== undefined) user.bio = bio;

        res.json({
            message: 'Профиль обновлен',
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                email: user.email,
                avatar: user.avatar,
                bio: user.bio
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Загрузка аватара
app.post('/api/avatar', authenticateToken, upload.single('avatar'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Файл не загружен' });
        }

        const user = users.find(u => u.id === req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        // Удаление старого аватара
        if (user.avatar) {
            const oldAvatarPath = path.join(__dirname, user.avatar);
            if (fs.existsSync(oldAvatarPath)) {
                fs.unlinkSync(oldAvatarPath);
            }
        }

        // Сохранение нового аватара
        user.avatar = `/uploads/${req.user.id}/${req.file.filename}`;

        res.json({
            message: 'Аватар обновлен',
            avatar: user.avatar
        });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка загрузки аватара' });
    }
});

// Поиск пользователей
app.get('/api/users/search', authenticateToken, (req, res) => {
    const query = req.query.q?.toLowerCase() || '';
    
    if (!query) {
        return res.json([]);
    }

    const results = users
        .filter(user => 
            user.username.toLowerCase().includes(query) ||
            user.name.toLowerCase().includes(query)
        )
        .map(user => ({
            id: user.id,
            name: user.name,
            username: user.username,
            avatar: user.avatar
        }));

    res.json(results);
});

// Получение постов ленты
app.get('/api/feed', authenticateToken, (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Получение постов от подписанных пользователей + свои посты
    const userFollows = followers[req.user.id] || [];
    const feedPosts = posts
        .filter(post => 
            post.authorId === req.user.id || 
            userFollows.includes(post.authorId)
        )
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(skip, skip + limit);

    res.json(feedPosts);
});

// Создание поста
app.post('/api/posts', authenticateToken, upload.array('media', 5), (req, res) => {
    try {
        const { content } = req.body;
        const user = users.find(u => u.id === req.user.id);

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        if (!content?.trim()) {
            return res.status(400).json({ error: 'Содержимое поста обязательно' });
        }

        // Обработка медиа файлов
        const media = req.files?.map(file => ({
            type: file.mimetype.startsWith('image/') ? 'image' : 'video',
            url: `/uploads/${req.user.id}/${file.filename}`
        })) || [];

        const newPost = {
            id: uuidv4(),
            authorId: user.id,
            authorName: user.name,
            authorUsername: user.username,
            authorAvatar: user.avatar,
            content: content.trim(),
            media,
            reactions: {
                like: [],
                dislike: [],
                heart: [],
                angry: [],
                laugh: [],
                cry: []
            },
            comments: [],
            createdAt: new Date().toISOString()
        };

        posts.unshift(newPost);

        // Оповещение подписчиков
        const userFollowers = Object.keys(followers).filter(
            followerId => followers[followerId].includes(user.id)
        );

        userFollowers.forEach(followerId => {
            sendNotification(followerId, {
                type: 'new_post',
                message: `${user.name} опубликовал новый пост`,
                postId: newPost.id
            });
        });

        // Трансляция нового поста в реальном времени
        io.emit('new_post', newPost);

        res.status(201).json(newPost);
    } catch (error) {
        res.status(500).json({ error: 'Ошибка создания поста' });
    }
});

// Реакция на пост
app.post('/api/posts/:postId/reactions', authenticateToken, (req, res) => {
    try {
        const { postId } = req.params;
        const { reaction } = req.body;

        if (!['like', 'dislike', 'heart', 'angry', 'laugh', 'cry'].includes(reaction)) {
            return res.status(400).json({ error: 'Неверный тип реакции' });
        }

        const post = posts.find(p => p.id === postId);
        if (!post) {
            return res.status(404).json({ error: 'Пост не найден' });
        }

        const userId = req.user.id;

        // Удаление предыдущих реакций
        Object.keys(post.reactions).forEach(type => {
            const index = post.reactions[type].indexOf(userId);
            if (index > -1) {
                post.reactions[type].splice(index, 1);
            }
        });

        // Добавление новой реакции
        post.reactions[reaction].push(userId);

        // Оповещение автора поста
        if (post.authorId !== userId) {
            sendNotification(post.authorId, {
                type: 'reaction',
                message: `Кто-то отреагировал на ваш пост`,
                postId: postId
            });
        }

        // Трансляция реакции в реальном времени
        io.emit('post_reaction', { postId, reactions: post.reactions });

        res.json({ message: 'Реакция добавлена', reactions: post.reactions });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка добавления реакции' });
    }
});

// Комментарий к посту
app.post('/api/posts/:postId/comments', authenticateToken, (req, res) => {
    try {
        const { postId } = req.params;
        const { text } = req.body;
        const user = users.find(u => u.id === req.user.id);

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        if (!text?.trim()) {
            return res.status(400).json({ error: 'Текст комментария обязателен' });
        }

        const post = posts.find(p => p.id === postId);
        if (!post) {
            return res.status(404).json({ error: 'Пост не найден' });
        }

        const newComment = {
            id: uuidv4(),
            authorId: user.id,
            authorName: user.name,
            authorUsername: user.username,
            authorAvatar: user.avatar,
            text: text.trim(),
            createdAt: new Date().toISOString()
        };

        post.comments.push(newComment);

        // Оповещение автора поста
        if (post.authorId !== user.id) {
            sendNotification(post.authorId, {
                type: 'comment',
                message: `${user.name} прокомментировал ваш пост`,
                postId: postId
            });
        }

        // Трансляция комментария в реальном времени
        io.emit('new_comment', { postId, comment: newComment });

        res.status(201).json(newComment);
    } catch (error) {
        res.status(500).json({ error: 'Ошибка добавления комментария' });
    }
});

// Подписка на пользователя
app.post('/api/users/:userId/follow', authenticateToken, (req, res) => {
    try {
        const { userId } = req.params;
        const followerId = req.user.id;

        if (userId === followerId) {
            return res.status(400).json({ error: 'Нельзя подписаться на себя' });
        }

        const targetUser = users.find(u => u.id === userId);
        if (!targetUser) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        if (!followers[followerId]) {
            followers[followerId] = [];
        }

        if (followers[followerId].includes(userId)) {
            // Отписка
            followers[followerId] = followers[followerId].filter(id => id !== userId);
            res.json({ message: 'Отписка выполнена', following: false });
        } else {
            // Подписка
            followers[followerId].push(userId);
            
            // Оповещение пользователя
            sendNotification(userId, {
                type: 'follow',
                message: 'На вас подписались',
                followerId: followerId
            });

            res.json({ message: 'Подписка выполнена', following: true });
        }
    } catch (error) {
        res.status(500).json({ error: 'Ошибка подписки' });
    }
});

// Получение уведомлений
app.get('/api/notifications', authenticateToken, (req, res) => {
    const userNotifications = notifications
        .filter(n => n.userId === req.user.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 50);

    res.json(userNotifications);
});

// Удаление аккаунта
app.delete('/api/account', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Удаление пользователя
        users = users.filter(u => u.id !== userId);

        // Удаление постов пользователя
        posts = posts.filter(p => p.authorId !== userId);

        // Удаление подписок
        delete followers[userId];
        Object.keys(followers).forEach(followerId => {
            followers[followerId] = followers[followerId].filter(id => id !== userId);
        });

        // Удаление уведомлений
        notifications = notifications.filter(n => n.userId !== userId);

        // Удаление папки с файлами
        const userFolder = path.join(UPLOAD_DIR, userId);
        if (fs.existsSync(userFolder)) {
            fs.rmSync(userFolder, { recursive: true, force: true });
        }

        res.json({ message: 'Аккаунт удален' });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка удаления аккаунта' });
    }
});

// Раздача статических файлов
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.use(express.static('.'));

// Запуск сервера
server.listen(PORT, () => {
    console.log(`🚀 Сервер Clone запущен на порту ${PORT}`);
    console.log(`📱 Откройте http://localhost:${PORT} в браузере`);
});

module.exports = app;
