// Глобальное состояние приложения
const app = {
    currentUser: null,
    token: null,
    posts: [],
    currentScreen: 'auth',
    theme: 'light',
    socket: null
};

// API базовый URL
const API_URL = window.location.origin + '/api';

// Инициализация приложения
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
    loadTheme();
    initializeSocket();
});

// Инициализация Socket.IO
function initializeSocket() {
    app.socket = io();
    
    app.socket.on('connect', () => {
        console.log('Подключено к серверу');
        if (app.token) {
            app.socket.emit('authenticate', app.token);
        }
    });
    
    app.socket.on('new_post', (post) => {
        if (app.currentScreen === 'feed') {
            addPostToFeed(post);
        }
    });
    
    app.socket.on('post_reaction', (data) => {
        updatePostReactions(data.postId, data.reactions);
    });
    
    app.socket.on('new_comment', (data) => {
        addCommentToPost(data.postId, data.comment);
    });
    
    app.socket.on('notification', (notification) => {
        showNotification(notification.message, 'info');
    });
}

// Инициализация
function initializeApp() {
    // Загрузка данных из localStorage
    const savedToken = localStorage.getItem('clone_token');
    const savedTheme = localStorage.getItem('clone_theme');
    
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
        document.getElementById('themeToggle').textContent = '☀️';
        app.theme = 'dark';
    }
    
    if (savedToken) {
        app.token = savedToken;
        verifyToken();
    }
}

// Проверка токена
async function verifyToken() {
    try {
        const response = await fetch(`${API_URL}/me`, {
            headers: {
                'Authorization': `Bearer ${app.token}`
            }
        });
        
        if (response.ok) {
            const userData = await response.json();
            app.currentUser = userData;
            showMainApp();
        } else {
            localStorage.removeItem('clone_token');
            app.token = null;
        }
    } catch (error) {
        console.error('Ошибка проверки токена:', error);
        localStorage.removeItem('clone_token');
        app.token = null;
    }
}

// Настройка обработчиков событий
function setupEventListeners() {
    // Аутентификация
    document.getElementById('loginFormElement').addEventListener('submit', handleLogin);
    document.getElementById('registerFormElement').addEventListener('submit', handleRegister);
    
    // Навигация
    document.getElementById('feedBtn').addEventListener('click', () => showScreen('feed'));
    document.getElementById('profileBtn').addEventListener('click', () => showScreen('profile'));
    
    // Посты
    document.getElementById('publishPostBtn').addEventListener('click', createPost);
    document.getElementById('attachMediaBtn').addEventListener('click', () => {
        document.getElementById('mediaInput').click();
    });
    document.getElementById('mediaInput').addEventListener('change', handleMediaAttach);
    
    // Профиль
    document.getElementById('changeAvatarBtn').addEventListener('click', () => {
        document.getElementById('avatarInput').click();
    });
    document.getElementById('avatarInput').addEventListener('change', handleAvatarChange);
    document.getElementById('editProfileBtn').addEventListener('click', openEditProfile);
    document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);
    
    // Поиск
    document.getElementById('searchInput').addEventListener('input', handleSearch);
    document.getElementById('refreshFeed').addEventListener('click', refreshFeed);
    
    // Настройки
    document.getElementById('settingsBtn').addEventListener('click', openSettings);
    document.getElementById('updateAccountBtn').addEventListener('click', updateAccount);
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('deleteAccountBtn').addEventListener('click', deleteAccount);
    
    // Тема
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    
    // Закрытие модальных окон
    document.querySelectorAll('.close-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            this.closest('.modal').classList.remove('active');
        });
    });
    
    // Закрытие модальных окон по клику вне их
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                this.classList.remove('active');
            }
        });
    });
}

// Переключение между формами входа и регистрации
function switchToRegister() {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('registerForm').classList.remove('hidden');
}

function switchToLogin() {
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('loginForm').classList.remove('hidden');
}

// Обработка входа
async function handleLogin(e) {
    e.preventDefault();
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const response = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            app.token = data.token;
            app.currentUser = data.user;
            localStorage.setItem('clone_token', app.token);
            
            showMainApp();
            showNotification('Вход выполнен успешно!', 'success');
            
            // Аутентификация в Socket.IO
            if (app.socket) {
                app.socket.emit('authenticate', app.token);
            }
        } else {
            showNotification(data.error || 'Ошибка входа', 'error');
        }
    } catch (error) {
        showNotification('Ошибка соединения с сервером', 'error');
    }
}

// Обработка регистрации
async function handleRegister(e) {
    e.preventDefault();
    
    const name = document.getElementById('registerName').value;
    const username = document.getElementById('registerUsername').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    
    try {
        const response = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, username, email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            app.token = data.token;
            app.currentUser = data.user;
            localStorage.setItem('clone_token', app.token);
            
            showMainApp();
            showNotification('Регистрация выполнена успешно!', 'success');
            
            // Аутентификация в Socket.IO
            if (app.socket) {
                app.socket.emit('authenticate', app.token);
            }
        } else {
            showNotification(data.error || 'Ошибка регистрации', 'error');
        }
    } catch (error) {
        showNotification('Ошибка соединения с сервером', 'error');
    }
}

// Показ главного приложения
function showMainApp() {
    document.getElementById('authScreen').classList.remove('active');
    document.getElementById('mainApp').classList.add('active');
    
    updateProfileInfo();
    loadPosts();
    showScreen('feed');
}

// Показ экранов
function showScreen(screenName) {
    app.currentScreen = screenName;
    
    // Скрыть все экраны контента
    document.querySelectorAll('.content-screen').forEach(screen => {
        screen.classList.remove('active');
    });
    
    // Обновить навигацию
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Показать нужный экран
    switch(screenName) {
        case 'feed':
            document.getElementById('feedScreen').classList.add('active');
            document.getElementById('feedBtn').classList.add('active');
            loadPosts();
            break;
        case 'profile':
            document.getElementById('profileScreen').classList.add('active');
            loadUserPosts();
            break;
        case 'search':
            document.getElementById('searchScreen').classList.add('active');
            break;
    }
}

// Создание поста
async function createPost() {
    const content = document.getElementById('postContent').value.trim();
    
    if (!content) {
        showNotification('Напишите что-нибудь для публикации', 'error');
        return;
    }
    
    const formData = new FormData();
    formData.append('content', content);
    
    // Добавление медиа файлов
    const mediaInput = document.getElementById('mediaInput');
    if (mediaInput.files.length > 0) {
        for (let file of mediaInput.files) {
            formData.append('media', file);
        }
    }
    
    try {
        const response = await fetch(`${API_URL}/posts`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${app.token}`
            },
            body: formData
        });
        
        if (response.ok) {
            document.getElementById('postContent').value = '';
            mediaInput.value = '';
            showNotification('Пост опубликован!', 'success');
        } else {
            const data = await response.json();
            showNotification(data.error || 'Ошибка публикации', 'error');
        }
    } catch (error) {
        showNotification('Ошибка соединения с сервером', 'error');
    }
}

// Загрузка постов
async function loadPosts() {
    try {
        const response = await fetch(`${API_URL}/feed`, {
            headers: {
                'Authorization': `Bearer ${app.token}`
            }
        });
        
        if (response.ok) {
            app.posts = await response.json();
            renderPosts();
        } else {
            showNotification('Ошибка загрузки ленты', 'error');
        }
    } catch (error) {
        showNotification('Ошибка соединения с сервером', 'error');
    }
}

// Отображение постов
function renderPosts() {
    const container = document.getElementById('postsContainer');
    container.innerHTML = '';
    
    if (app.posts.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Пока нет постов</p>';
        return;
    }
    
    app.posts.forEach(post => {
        const postElement = createPostElement(post);
        container.appendChild(postElement);
    });
}

// Добавление поста в ленту (реальное время)
function addPostToFeed(post) {
    app.posts.unshift(post);
    const container = document.getElementById('postsContainer');
    const postElement = createPostElement(post);
    container.insertBefore(postElement, container.firstChild);
}

// Создание элемента поста
function createPostElement(post) {
    const postDiv = document.createElement('div');
    postDiv.className = 'post';
    postDiv.dataset.postId = post.id;
    
    const avatarHtml = post.authorAvatar 
        ? `<img src="${post.authorAvatar}" alt="${post.authorName}">`
        : '😊';
    
    const mediaHtml = post.media && post.media.length > 0 
        ? post.media.map(item => `
            <div class="post-media">
                ${item.type === 'image' 
                    ? `<img src="${item.url}" alt="Изображение">`
                    : `<video src="${item.url}" controls></video>`
                }
            </div>
          `).join('')
        : '';
    
    const reactionsHtml = Object.entries(post.reactions).map(([reaction, users]) => {
        const isActive = users.includes(app.currentUser?.id);
        const emoji = getReactionEmoji(reaction);
        const count = users.length;
        return `<button class="reaction-btn ${isActive ? 'active' : ''}" 
                        onclick="toggleReaction('${post.id}', '${reaction}')">
                    ${emoji} ${count > 0 ? `<span class="reaction-count">${count}</span>` : ''}
                </button>`;
    }).join('');
    
    const commentsHtml = post.comments.map(comment => `
        <div class="comment">
            <div class="comment-avatar">${comment.authorAvatar || '😊'}</div>
            <div class="comment-content">
                <div class="comment-author">${comment.authorName}</div>
                <div class="comment-text">${comment.text}</div>
            </div>
        </div>
    `).join('');
    
    postDiv.innerHTML = `
        <div class="post-header">
            <div class="post-avatar">${avatarHtml}</div>
            <div class="post-info">
                <div class="post-author">${post.authorName}</div>
                <div class="post-username">@${post.authorUsername}</div>
            </div>
            <div class="post-time">${formatTime(post.createdAt)}</div>
        </div>
        <div class="post-content">${post.content}</div>
        ${mediaHtml}
        <div class="post-actions-bar">
            ${reactionsHtml}
        </div>
        <div class="comments-section">
            ${commentsHtml}
            <div class="comment-input-container">
                <input type="text" class="comment-input" placeholder="Написать комментарий..." 
                       onkeypress="if(event.key === 'Enter') addComment('${post.id}', this.value)">
                <button onclick="addComment('${post.id}', this.previousElementSibling.value)">💬</button>
            </div>
        </div>
    `;
    
    return postDiv;
}

// Получение эмодзи для реакции
function getReactionEmoji(reaction) {
    const emojis = {
        like: '👍',
        dislike: '👎',
        heart: '❤️',
        angry: '😡',
        laugh: '😂',
        cry: '😢'
    };
    return emojis[reaction] || '👍';
}

// Переключение реакции
async function toggleReaction(postId, reactionType) {
    try {
        const response = await fetch(`${API_URL}/posts/${postId}/reactions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${app.token}`
            },
            body: JSON.stringify({ reaction: reactionType })
        });
        
        if (response.ok) {
            const data = await response.json();
            updatePostReactions(postId, data.reactions);
        } else {
            const data = await response.json();
            showNotification(data.error || 'Ошибка реакции', 'error');
        }
    } catch (error) {
        showNotification('Ошибка соединения с сервером', 'error');
    }
}

// Обновление реакций поста
function updatePostReactions(postId, reactions) {
    const post = app.posts.find(p => p.id === postId);
    if (post) {
        post.reactions = reactions;
        
        const postElement = document.querySelector(`[data-post-id="${postId}"]`);
        if (postElement) {
            const reactionsHtml = Object.entries(reactions).map(([reaction, users]) => {
                const isActive = users.includes(app.currentUser?.id);
                const emoji = getReactionEmoji(reaction);
                const count = users.length;
                return `<button class="reaction-btn ${isActive ? 'active' : ''}" 
                                onclick="toggleReaction('${postId}', '${reaction}')">
                            ${emoji} ${count > 0 ? `<span class="reaction-count">${count}</span>` : ''}
                        </button>`;
            }).join('');
            
            postElement.querySelector('.post-actions-bar').innerHTML = reactionsHtml;
        }
    }
}

// Добавление комментария
async function addComment(postId, text) {
    if (!text.trim()) return;
    
    try {
        const response = await fetch(`${API_URL}/posts/${postId}/comments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${app.token}`
            },
            body: JSON.stringify({ text: text.trim() })
        });
        
        if (response.ok) {
            const comment = await response.json();
            addCommentToPost(postId, comment);
        } else {
            const data = await response.json();
            showNotification(data.error || 'Ошибка комментария', 'error');
        }
    } catch (error) {
        showNotification('Ошибка соединения с сервером', 'error');
    }
}

// Добавление комментария к посту (реальное время)
function addCommentToPost(postId, comment) {
    const post = app.posts.find(p => p.id === postId);
    if (post) {
        post.comments.push(comment);
        
        const postElement = document.querySelector(`[data-post-id="${postId}"]`);
        if (postElement) {
            const commentsSection = postElement.querySelector('.comments-section');
            const commentHtml = `
                <div class="comment">
                    <div class="comment-avatar">${comment.authorAvatar || '😊'}</div>
                    <div class="comment-content">
                        <div class="comment-author">${comment.authorName}</div>
                        <div class="comment-text">${comment.text}</div>
                    </div>
                </div>
            `;
            
            const inputContainer = commentsSection.querySelector('.comment-input-container');
            inputContainer.insertAdjacentHTML('beforebegin', commentHtml);
            
            // Очистка поля ввода
            inputContainer.querySelector('.comment-input').value = '';
        }
    }
}

// Загрузка постов пользователя
async function loadUserPosts() {
    try {
        // В реальном приложении здесь был бы API endpoint
        // Для демо фильтруем посты текущего пользователя
        const userPosts = app.posts.filter(post => post.authorId === app.currentUser.id);
        renderUserPosts(userPosts);
    } catch (error) {
        showNotification('Ошибка загрузки постов', 'error');
    }
}

// Отображение постов пользователя
function renderUserPosts(posts) {
    const container = document.getElementById('userPostsContainer');
    container.innerHTML = '';
    
    if (posts.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">У вас пока нет постов</p>';
        return;
    }
    
    posts.forEach(post => {
        const postElement = createPostElement(post);
        container.appendChild(postElement);
    });
}

// Обновление информации профиля
function updateProfileInfo() {
    if (!app.currentUser) return;
    
    document.getElementById('profileName').textContent = app.currentUser.name;
    document.getElementById('profileUsername').textContent = '@' + app.currentUser.username;
    document.getElementById('profileBio').textContent = app.currentUser.bio || 'Описание профиля';
    
    const avatarImg = document.getElementById('profileAvatar');
    const avatarPlaceholder = document.getElementById('avatarPlaceholder');
    
    if (app.currentUser.avatar) {
        avatarImg.src = app.currentUser.avatar;
        avatarImg.style.display = 'block';
        avatarPlaceholder.style.display = 'none';
    } else {
        avatarImg.style.display = 'none';
        avatarPlaceholder.style.display = 'flex';
    }
}

// Обработка смены аватара
async function handleAvatarChange(e) {
    const file = e.target.files[0];
    if (file) {
        const formData = new FormData();
        formData.append('avatar', file);
        
        try {
            const response = await fetch(`${API_URL}/avatar`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${app.token}`
                },
                body: formData
            });
            
            if (response.ok) {
                const data = await response.json();
                app.currentUser.avatar = data.avatar;
                updateProfileInfo();
                loadPosts();
                showNotification('Аватар обновлен!', 'success');
            } else {
                const data = await response.json();
                showNotification(data.error || 'Ошибка загрузки аватара', 'error');
            }
        } catch (error) {
            showNotification('Ошибка соединения с сервером', 'error');
        }
    }
}

// Открытие редактирования профиля
function openEditProfile() {
    document.getElementById('editName').value = app.currentUser.name;
    document.getElementById('editUsername').value = app.currentUser.username;
    document.getElementById('editBio').value = app.currentUser.bio || '';
    document.getElementById('editProfileModal').classList.add('active');
}

function closeEditProfile() {
    document.getElementById('editProfileModal').classList.remove('active');
}

// Сохранение профиля
async function saveProfile() {
    const name = document.getElementById('editName').value.trim();
    const username = document.getElementById('editUsername').value.trim();
    const bio = document.getElementById('editBio').value.trim();
    
    if (!name || !username) {
        showNotification('Имя и username обязательны', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/profile`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${app.token}`
            },
            body: JSON.stringify({ name, username, bio })
        });
        
        if (response.ok) {
            const data = await response.json();
            app.currentUser = data.user;
            updateProfileInfo();
            loadPosts();
            closeEditProfile();
            showNotification('Профиль обновлен!', 'success');
        } else {
            const data = await response.json();
            showNotification(data.error || 'Ошибка обновления профиля', 'error');
        }
    } catch (error) {
        showNotification('Ошибка соединения с сервером', 'error');
    }
}

// Поиск пользователей
async function handleSearch(e) {
    const query = e.target.value.trim().toLowerCase();
    
    if (!query) {
        showScreen('feed');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/users/search?q=${encodeURIComponent(query)}`, {
            headers: {
                'Authorization': `Bearer ${app.token}`
            }
        });
        
        if (response.ok) {
            const users = await response.json();
            displaySearchResults(users);
            showScreen('search');
        } else {
            showNotification('Ошибка поиска', 'error');
        }
    } catch (error) {
        showNotification('Ошибка соединения с сервером', 'error');
    }
}

// Отображение результатов поиска
function displaySearchResults(users) {
    const container = document.getElementById('searchResultsContainer');
    container.innerHTML = '';
    
    if (users.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Пользователи не найдены</p>';
        return;
    }
    
    users.forEach(user => {
        const userCard = document.createElement('div');
        userCard.className = 'user-card';
        userCard.onclick = () => viewUserProfile(user);
        
        const avatarHtml = user.avatar 
            ? `<img src="${user.avatar}" alt="${user.name}">`
            : '😊';
        
        userCard.innerHTML = `
            <div class="user-card-avatar">${avatarHtml}</div>
            <div class="user-card-info">
                <div class="user-card-name">${user.name}</div>
                <div class="user-card-username">@${user.username}</div>
            </div>
            <button class="follow-btn" onclick="event.stopPropagation(); toggleFollow('${user.id}')">
                Подписаться
            </button>
        `;
        
        container.appendChild(userCard);
    });
}

// Просмотр профиля пользователя
function viewUserProfile(user) {
    showNotification(`Профиль @${user.username}`, 'info');
    showScreen('feed');
}

// Подписка/отписка
async function toggleFollow(userId) {
    try {
        const response = await fetch(`${API_URL}/users/${userId}/follow`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${app.token}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            showNotification(data.message, 'success');
        } else {
            const data = await response.json();
            showNotification(data.error || 'Ошибка подписки', 'error');
        }
    } catch (error) {
        showNotification('Ошибка соединения с сервером', 'error');
    }
}

// Обновление ленты
function refreshFeed() {
    loadPosts();
    showNotification('Лента обновлена', 'success');
}

// Настройки
function openSettings() {
    document.getElementById('settingsModal').classList.add('active');
}

function closeSettings() {
    document.getElementById('settingsModal').classList.remove('active');
}

// Обновление аккаунта
async function updateAccount() {
    const newEmail = document.getElementById('newEmail').value.trim();
    const newPassword = document.getElementById('newPassword').value;
    
    if (!newEmail && !newPassword) {
        showNotification('Введите новые данные', 'error');
        return;
    }
    
    // В реальном приложении здесь был бы API endpoint
    showNotification('Функция обновления аккаунта в разработке', 'info');
    
    // Очистка полей
    document.getElementById('newEmail').value = '';
    document.getElementById('newPassword').value = '';
}

// Выход из аккаунта
function logout() {
    if (confirm('Вы уверены, что хотите выйти?')) {
        localStorage.removeItem('clone_token');
        app.token = null;
        app.currentUser = null;
        
        if (app.socket) {
            app.socket.disconnect();
            app.socket = null;
        }
        
        document.getElementById('mainApp').classList.remove('active');
        document.getElementById('authScreen').classList.add('active');
        
        // Очистка форм
        document.getElementById('loginFormElement').reset();
        document.getElementById('registerFormElement').reset();
        
        showNotification('Вы вышли из аккаунта', 'info');
    }
}

// Удаление аккаунта
async function deleteAccount() {
    if (confirm('Вы уверены, что хотите удалить аккаунт? Это действие нельзя отменить!')) {
        try {
            const response = await fetch(`${API_URL}/account`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${app.token}`
                }
            });
            
            if (response.ok) {
                localStorage.removeItem('clone_token');
                app.token = null;
                app.currentUser = null;
                
                if (app.socket) {
                    app.socket.disconnect();
                    app.socket = null;
                }
                
                document.getElementById('mainApp').classList.remove('active');
                document.getElementById('authScreen').classList.add('active');
                
                showNotification('Аккаунт удален', 'info');
            } else {
                const data = await response.json();
                showNotification(data.error || 'Ошибка удаления аккаунта', 'error');
            }
        } catch (error) {
            showNotification('Ошибка соединения с сервером', 'error');
        }
    }
}

// Тема
function toggleTheme() {
    const body = document.body;
    const themeBtn = document.getElementById('themeToggle');
    
    if (body.classList.contains('dark-theme')) {
        body.classList.remove('dark-theme');
        themeBtn.textContent = '🌙';
        app.theme = 'light';
    } else {
        body.classList.add('dark-theme');
        themeBtn.textContent = '☀️';
        app.theme = 'dark';
    }
    
    localStorage.setItem('clone_theme', app.theme);
}

function loadTheme() {
    const savedTheme = localStorage.getItem('clone_theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
        document.getElementById('themeToggle').textContent = '☀️';
        app.theme = 'dark';
    }
}

// Уведомления
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Позиционирование
    notification.style.position = 'fixed';
    notification.style.top = '1rem';
    notification.style.right = '1rem';
    notification.style.zIndex = '2000';
    notification.style.animation = 'fadeIn 0.3s ease-out';
    
    // Автоматическое удаление
    setTimeout(() => {
        notification.style.animation = 'fadeOut 0.3s ease-out';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// Форматирование времени
function formatTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'только что';
    if (minutes < 60) return `${minutes} мин назад`;
    if (hours < 24) return `${hours} ч назад`;
    if (days < 7) return `${days} д назад`;
    
    return date.toLocaleDateString('ru-RU');
}

// Обработка медиа файлов
function handleMediaAttach(e) {
    const files = e.target.files;
    if (files.length > 0) {
        showNotification(`Выбрано файлов: ${files.length}`, 'success');
    }
}

// Добавление стилей для анимации fadeOut
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeOut {
        from { opacity: 1; transform: translateY(0); }
        to { opacity: 0; transform: translateY(-10px); }
    }
    
    .follow-btn {
        background: var(--primary-color);
        color: white;
        border: none;
        padding: 0.5rem 1rem;
        border-radius: var(--radius-md);
        cursor: pointer;
        font-size: 0.875rem;
        transition: background-color 0.2s;
    }
    
    .follow-btn:hover {
        background: var(--primary-hover);
    }
`;
document.head.appendChild(style);
