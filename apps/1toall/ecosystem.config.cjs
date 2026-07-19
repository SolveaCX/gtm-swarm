module.exports = {
  apps: [{
    name: '1toall',
    script: 'server.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '1G',
    kill_timeout: 15000,
    listen_timeout: 30000,
    env_production: {
      NODE_ENV: 'production',
      PORT: 4178,
    },
  }],
};
