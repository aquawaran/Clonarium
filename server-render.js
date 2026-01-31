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

// Импорт базы данных
const { initDatabase, User, Post, Follow, Notification } = require('./database');

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
        const userFolder = path.join(UPLOAD_DIR, req.user?.id || 'temp');
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
const sendNotification = async (userId, notification) => {
    const socketId = connectedUsers.get(userId);
    if (socketId) {
        io.to(socketId).emit('notification', notification);
    }
    
    await Notification.create({
        user_id: userId,
        type: notification.type,
        message: notification.message,
        data: notification.data || {}
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
        const existingUser = await User.findByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'Пользователь с такой почтой уже существует' });
        }

        const existingUsername = await User.findByUsername(username);
        if (existingUsername) {
            return res.status(400).json({ error: 'Этот username уже занят' });
        }

        // Хеширование пароля
        const hashedPassword = await bcrypt.hash(password, 10);

        // Создание пользователя
        const newUser = await User.create({
            name,
            username,
            email,
            password: hashedPassword
        });

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
        console.error('Ошибка регистрации:', error);
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
        const user = await User.findByEmail(email);
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
        console.error('Ошибка входа:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение текущего пользователя
app.get('/api/me', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
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
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Обновление профиля
app.put('/api/profile', authenticateToken, async (req, res) => {
    try {
        const { name, username, bio } = req.body;

        // Валидация
        if (username && username.length < 4) {
            return res.status(400).json({ error: 'Username должен содержать минимум 4 символа' });
        }

        // Проверка уникальности username
        if (username) {
            const existingUsername = await User.findByUsername(username);
            if (existingUsername && existingUsername.id !== req.user.id) {
                return res.status(400).json({ error: 'Этот username уже занят' });
            }
        }

        // Обновление данных
        const updatedUser = await User.update(req.user.id, { name, username, bio });

        res.json({
            message: 'Профиль обновлен',
            user: {
                id: updatedUser.id,
                name: updatedUser.name,
                username: updatedUser.username,
                email: updatedUser.email,
                avatar: updatedUser.avatar,
                bio: updatedUser.bio
            }
        });
    } catch (error) {
        console.error('Ошибка обновления профиля:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Загрузка аватара
app.post('/api/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Файл не загружен' });
        }

        const avatarUrl = `/uploads/${req.user.id}/${req.file.filename}`;
        const updatedUser = await User.updateAvatar(req.user.id, avatarUrl);

        res.json({
            message: 'Аватар обновлен',
            avatar: updatedUser.avatar
        });
    } catch (error) {
        console.error('Ошибка загрузки аватара:', error);
        res.status(500).json({ error: 'Ошибка загрузки аватара' });
    }
});

// Поиск пользователей
app.get('/api/users/search', authenticateToken, async (req, res) => {
    try {
        const query = req.query.q || '';
        
        if (!query) {
            return res.json([]);
        }

        console.log('Поиск пользователей:', query); // Отладка
        
        const results = await User.search(query);
        console.log('Результаты поиска:', results); // Отладка
        
        res.json(results);
    } catch (error) {
        console.error('Ошибка поиска:', error);
        res.status(500).json({ error: 'Ошибка поиска' });
    }
});

// Получение информации о пользователе
app.get('/api/users/:userId', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Получаем количество подписчиков
        const followers = await Follow.getFollowers(userId);
        const following = await Follow.getFollowing(userId);
        
        // Проверяем подписан ли текущий пользователь
        let isFollowing = false;
        if (userId !== req.user.id) {
            const userFollowing = await Follow.getFollowing(req.user.id);
            isFollowing = userFollowing.includes(userId);
        }
        
        res.json({
            id: user.id,
            name: user.name,
            username: user.username,
            avatar: user.avatar,
            bio: user.bio,
            followersCount: followers.length,
            followingCount: following.length,
            isFollowing
        });
    } catch (error) {
        console.error('Ошибка получения пользователя:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение постов пользователя
app.get('/api/users/:userId/posts', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const userPosts = await Post.getUserPosts(userId, limit, offset);
        res.json(userPosts);
    } catch (error) {
        console.error('Ошибка загрузки постов пользователя:', error);
        res.status(500).json({ error: 'Ошибка загрузки постов' });
    }
});

// Получение постов ленты
app.get('/api/feed', authenticateToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const feedPosts = await Post.getFeed(limit, offset);
        res.json(feedPosts);
    } catch (error) {
        console.error('Ошибка загрузки ленты:', error);
        res.status(500).json({ error: 'Ошибка загрузки ленты' });
    }
});

// Создание поста
app.post('/api/posts', authenticateToken, upload.array('media', 5), async (req, res) => {
    try {
        const { content } = req.body;
        const user = await User.findById(req.user.id);

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

        const newPost = await Post.create({
            author_id: user.id,
            content: content.trim(),
            media
        });

        // Добавление информации об авторе
        const postWithAuthor = {
            ...newPost,
            author_name: user.name,
            author_username: user.username,
            author_avatar: user.avatar
        };

        // Оповещение подписчиков
        const followers = await Follow.getFollowers(user.id);
        followers.forEach(followerId => {
            sendNotification(followerId, {
                type: 'new_post',
                message: `${user.name} опубликовал новый пост`,
                data: { postId: newPost.id }
            });
        });

        // Трансляция нового поста в реальном времени
        io.emit('new_post', postWithAuthor);

        res.status(201).json(postWithAuthor);
    } catch (error) {
        console.error('Ошибка создания поста:', error);
        res.status(500).json({ error: 'Ошибка создания поста' });
    }
});

// Реакция на пост
app.post('/api/posts/:postId/reactions', authenticateToken, async (req, res) => {
    try {
        const { postId } = req.params;
        const { reaction } = req.body;

        if (!['like', 'dislike', 'heart', 'angry', 'laugh', 'cry'].includes(reaction)) {
            return res.status(400).json({ error: 'Неверный тип реакции' });
        }

        const updatedPost = await Post.addReaction(postId, req.user.id, reaction);
        if (!updatedPost) {
            return res.status(404).json({ error: 'Пост не найден' });
        }

        // Оповещение автора поста
        if (updatedPost.author_id !== req.user.id) {
            sendNotification(updatedPost.author_id, {
                type: 'reaction',
                message: `Кто-то отреагировал на ваш пост`,
                data: { postId }
            });
        }

        // Трансляция реакции в реальном времени
        io.emit('post_reaction', { postId, reactions: updatedPost.reactions });

        res.json({ message: 'Реакция добавлена', reactions: updatedPost.reactions });
    } catch (error) {
        console.error('Ошибка добавления реакции:', error);
        res.status(500).json({ error: 'Ошибка добавления реакции' });
    }
});

// Комментарий к посту
app.post('/api/posts/:postId/comments', authenticateToken, async (req, res) => {
    try {
        const { postId } = req.params;
        const { text } = req.body;
        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        if (!text?.trim()) {
            return res.status(400).json({ error: 'Текст комментария обязателен' });
        }

        const post = await Post.findById(postId);
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

        const updatedPost = await Post.addComment(postId, newComment);

        // Оповещение автора поста
        if (post.author_id !== user.id) {
            sendNotification(post.author_id, {
                type: 'comment',
                message: `${user.name} прокомментировал ваш пост`,
                data: { postId }
            });
        }

        // Трансляция комментария в реальном времени
        io.emit('new_comment', { postId, comment: newComment });

        res.status(201).json(newComment);
    } catch (error) {
        console.error('Ошибка добавления комментария:', error);
        res.status(500).json({ error: 'Ошибка добавления комментария' });
    }
});

// Подписка на пользователя
app.post('/api/users/:userId/follow', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.params;
        const followerId = req.user.id;

        if (userId === followerId) {
            return res.status(400).json({ error: 'Нельзя подписаться на себя' });
        }

        const targetUser = await User.findById(userId);
        if (!targetUser) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const isFollowing = await Follow.toggle(followerId, userId);

        if (isFollowing) {
            // Подписка
            sendNotification(userId, {
                type: 'follow',
                message: 'На вас подписались',
                data: { followerId }
            });
            res.json({ message: 'Подписка выполнена', following: true });
        } else {
            // Отписка
            res.json({ message: 'Отписка выполнена', following: false });
        }
    } catch (error) {
        console.error('Ошибка подписки:', error);
        res.status(500).json({ error: 'Ошибка подписки' });
    }
});

// Получение уведомлений
app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const notifications = await Notification.getUserNotifications(req.user.id);
        res.json(notifications);
    } catch (error) {
        console.error('Ошибка получения уведомлений:', error);
        res.status(500).json({ error: 'Ошибка получения уведомлений' });
    }
});

// Отметить уведомления как прочитанные
app.post('/api/notifications/read', authenticateToken, async (req, res) => {
    try {
        await Notification.markAsRead(req.user.id);
        res.json({ message: 'Уведомления отмечены как прочитанные' });
    } catch (error) {
        console.error('Ошибка отметки уведомлений:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Удаление аккаунта
app.delete('/api/account', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Удаление пользователя (каскадное удаление сработает для постов)
        await User.delete(userId);

        // Удаление папки с файлами
        const userFolder = path.join(UPLOAD_DIR, userId);
        if (fs.existsSync(userFolder)) {
            fs.rmSync(userFolder, { recursive: true, force: true });
        }

        res.json({ message: 'Аккаунт удален' });
    } catch (error) {
        console.error('Ошибка удаления аккаунта:', error);
        res.status(500).json({ error: 'Ошибка удаления аккаунта' });
    }
});

// Раздача статических файлов
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.use(express.static('.'));

// Инициализация базы данных и запуск сервера
initDatabase().then(() => {
    server.listen(PORT, () => {
        console.log(`🚀 Сервер Clone запущен на порту ${PORT}`);
        console.log(`📱 Откройте http://localhost:${PORT} в браузере`);
    });
}).catch(error => {
    console.error('Ошибка инициализации базы данных:', error);
    process.exit(1);
});

module.exports = app;
