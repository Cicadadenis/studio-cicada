// Simple users storage in memory (loaded from localStorage)
const STORAGE_KEY = 'cicada_users';
const SESSION_KEY = 'cicada_session';

// Hash password (simple hash for demo)
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Load users from localStorage
function loadUsers() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// Save users to localStorage
function saveUsers(users) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
}

// Register new user
export async function registerUser(name, email, password) {
  const users = loadUsers();

  // Check if user exists
  if (users.find(u => u.email === email)) {
    throw new Error('Пользователь с таким email уже существует');
  }

  const hashedPassword = await hashPassword(password);
  const user = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    name,
    email,
    password: hashedPassword,
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  saveUsers(users);

  const { password: _, ...userWithoutPassword } = user;
  await saveSession(userWithoutPassword);
  return userWithoutPassword;
}

// Login user
export async function loginUser(email, password) {
  const users = loadUsers();

  const user = users.find(u => u.email === email);
  if (!user) {
    throw new Error('Неверный email или пароль');
  }

  const hashedPassword = await hashPassword(password);
  if (user.password !== hashedPassword) {
    throw new Error('Неверный email или пароль');
  }

  const { password: _, ...userWithoutPassword } = user;
  await saveSession(userWithoutPassword);
  return userWithoutPassword;
}

// Session management
export async function saveSession(user) {
  if (user) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

export async function getSession() {
  try {
    const data = localStorage.getItem(SESSION_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export async function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// Update user
export async function updateUser(userId, updates) {
  const users = loadUsers();
  const index = users.findIndex(u => u.id === userId);

  if (index === -1) {
    throw new Error('Пользователь не найден');
  }

  // Check email uniqueness if email is being updated
  if (updates.email && updates.email !== users[index].email) {
    if (users.find(u => u.email === updates.email && u.id !== userId)) {
      throw new Error('Email уже используется');
    }
  }

  // Hash password if provided
  if (updates.password) {
    updates.password = await hashPassword(updates.password);
  }

  users[index] = { ...users[index], ...updates };
  saveUsers(users);

  const { password: _, ...userWithoutPassword } = users[index];
  await saveSession(userWithoutPassword);
  return userWithoutPassword;
}
