import { MMKV } from 'react-native-mmkv';

const storage = new MMKV({ id: 'budget-app-storage' });
const USER_KEY_KEY = 'budgetapp.user.key';

export const getUserKey = (): string => {
  let userKey = storage.getString(USER_KEY_KEY);
  if (!userKey) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let newKey = '';
    for (let i = 0; i < 6; i++) {
      newKey += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    userKey = newKey;
    storage.set(USER_KEY_KEY, userKey);
  }

  return userKey;
};

export const setUserKey = (key: string): void => {
  storage.set(USER_KEY_KEY, key);
};
