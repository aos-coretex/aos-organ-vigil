const isProduction = process.env.NODE_ENV === 'production';

export const config = {
  port: parseInt(process.env.VIGIL_PORT || (isProduction ? '3915' : '4015'), 10),
  dbPath: process.env.VIGIL_DB_PATH || './data/vigil.db',
  binding: '127.0.0.1',
};
