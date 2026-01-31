const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Инициализация базы данных
async function initDatabase() {
  try {
    // Таблица пользователей
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        avatar TEXT,
        bio TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Таблица постов
    await pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        author_id UUID REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        media JSONB DEFAULT '[]',
        reactions JSONB DEFAULT '{"like": [], "dislike": [], "heart": [], "angry": [], "laugh": [], "cry": []}',
        comments JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Таблица подписок
    await pool.query(`
      CREATE TABLE IF NOT EXISTS followers (
        follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
        following_id UUID REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (follower_id, following_id)
      )
    `);

    // Таблица уведомлений
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        data JSONB DEFAULT '{}',
        read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('База данных инициализирована');
  } catch (error) {
    console.error('Ошибка инициализации БД:', error);
  }
}

// Модели данных
const User = {
  // Создание пользователя
  async create(userData) {
    const { name, username, email, password } = userData;
    const result = await pool.query(
      'INSERT INTO users (name, username, email, password) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, username, email, password]
    );
    return result.rows[0];
  },

  // Поиск по email
  async findByEmail(email) {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0];
  },

  // Поиск по username
  async findByUsername(username) {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    return result.rows[0];
  },

  // Поиск по ID
  async findById(id) {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0];
  },

  // Обновление профиля
  async update(id, userData) {
    const { name, username, bio } = userData;
    const result = await pool.query(
      'UPDATE users SET name = $1, username = $2, bio = $3 WHERE id = $4 RETURNING *',
      [name, username, bio, id]
    );
    return result.rows[0];
  },

  // Обновление аватара
  async updateAvatar(id, avatar) {
    const result = await pool.query(
      'UPDATE users SET avatar = $1 WHERE id = $2 RETURNING *',
      [avatar, id]
    );
    return result.rows[0];
  },

  // Поиск пользователей (нечувствительный к регистру)
  async search(query) {
    const result = await pool.query(
      'SELECT id, name, username, avatar FROM users WHERE LOWER(username) LIKE LOWER($1) OR LOWER(name) LIKE LOWER($1) LIMIT 20',
      [`%${query}%`]
    );
    return result.rows;
  },

  // Удаление пользователя
  async delete(id) {
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
  }
};

const Post = {
  // Создание поста
  async create(postData) {
    const { author_id, content, media } = postData;
    const result = await pool.query(
      'INSERT INTO posts (author_id, content, media) VALUES ($1, $2, $3) RETURNING *',
      [author_id, content, JSON.stringify(media || [])]
    );
    return result.rows[0];
  },

  // Получение ленты (все посты всех пользователей)
  async getFeed(limit = 10, offset = 0) {
    const result = await pool.query(`
      SELECT p.*, u.name as author_name, u.username as author_username, u.avatar as author_avatar
      FROM posts p
      JOIN users u ON p.author_id = u.id
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    return result.rows;
  },

  // Получение постов пользователя
  async getUserPosts(userId, limit = 10, offset = 0) {
    const result = await pool.query(`
      SELECT p.*, u.name as author_name, u.username as author_username, u.avatar as author_avatar
      FROM posts p
      JOIN users u ON p.author_id = u.id
      WHERE p.author_id = $1
      ORDER BY p.created_at DESC
      LIMIT $2 OFFSET $3
    `, [userId, limit, offset]);
    return result.rows;
  },

  // Получение поста по ID
  async findById(id) {
    const result = await pool.query(`
      SELECT p.*, u.name as author_name, u.username as author_username, u.avatar as author_avatar
      FROM posts p
      JOIN users u ON p.author_id = u.id
      WHERE p.id = $1
    `, [id]);
    return result.rows[0];
  },

  // Добавление реакции
  async addReaction(postId, userId, reaction) {
    const post = await this.findById(postId);
    if (!post) return null;

    const reactions = { ...post.reactions };
    
    // Удаление предыдущих реакций
    Object.keys(reactions).forEach(key => {
      reactions[key] = reactions[key].filter(id => id !== userId);
    });

    // Добавление новой реакции
    if (reactions[reaction]) {
      reactions[reaction].push(userId);
    } else {
      reactions[reaction] = [userId];
    }

    const result = await pool.query(
      'UPDATE posts SET reactions = $1 WHERE id = $2 RETURNING *',
      [JSON.stringify(reactions), postId]
    );
    return result.rows[0];
  },

  // Добавление комментария
  async addComment(postId, commentData) {
    const post = await this.findById(postId);
    if (!post) return null;

    const comments = [...post.comments, commentData];
    
    const result = await pool.query(
      'UPDATE posts SET comments = $1 WHERE id = $2 RETURNING *',
      [JSON.stringify(comments), postId]
    );
    return result.rows[0];
  },

  // Удаление постов пользователя
  async deleteByUserId(userId) {
    await pool.query('DELETE FROM posts WHERE author_id = $1', [userId]);
  }
};

const Follow = {
  // Подписка/отписка
  async toggle(followerId, followingId) {
    // Проверка существования подписки
    const existing = await pool.query(
      'SELECT * FROM followers WHERE follower_id = $1 AND following_id = $2',
      [followerId, followingId]
    );

    if (existing.rows.length > 0) {
      // Отписка
      await pool.query(
        'DELETE FROM followers WHERE follower_id = $1 AND following_id = $2',
        [followerId, followingId]
      );
      return false;
    } else {
      // Подписка
      await pool.query(
        'INSERT INTO followers (follower_id, following_id) VALUES ($1, $2)',
        [followerId, followingId]
      );
      return true;
    }
  },

  // Получение подписок пользователя
  async getFollowing(userId) {
    const result = await pool.query(
      'SELECT following_id FROM followers WHERE follower_id = $1',
      [userId]
    );
    return result.rows.map(row => row.following_id);
  },

  // Получение подписчиков
  async getFollowers(userId) {
    const result = await pool.query(
      'SELECT follower_id FROM followers WHERE following_id = $1',
      [userId]
    );
    return result.rows.map(row => row.follower_id);
  }
};

const Notification = {
  // Создание уведомления
  async create(notificationData) {
    const { user_id, type, message, data } = notificationData;
    const result = await pool.query(
      'INSERT INTO notifications (user_id, type, message, data) VALUES ($1, $2, $3, $4) RETURNING *',
      [user_id, type, message, JSON.stringify(data || {})]
    );
    return result.rows[0];
  },

  // Получение уведомлений пользователя
  async getUserNotifications(userId, limit = 50) {
    const result = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    return result.rows;
  },

  // Отметить как прочитанные
  async markAsRead(userId) {
    await pool.query(
      'UPDATE notifications SET read = TRUE WHERE user_id = $1',
      [userId]
    );
  },

  // Удаление уведомлений пользователя
  async deleteByUserId(userId) {
    await pool.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
  }
};

module.exports = {
  pool,
  initDatabase,
  User,
  Post,
  Follow,
  Notification
};
