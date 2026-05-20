# Task Tracker

## Локальный запуск
```bash
npm install
npm run dev
```

## Deploy на Vercel

1. Загрузи папку на GitHub
2. Зайди на vercel.com → New Project → выбери репо
3. В настройках проекта добавь Environment Variables:

| Key | Value |
|-----|-------|
| VITE_FIREBASE_API_KEY | из Firebase Console |
| VITE_FIREBASE_AUTH_DOMAIN | из Firebase Console |
| VITE_FIREBASE_PROJECT_ID | из Firebase Console |
| VITE_FIREBASE_STORAGE_BUCKET | из Firebase Console |
| VITE_FIREBASE_MESSAGING_SENDER_ID | из Firebase Console |
| VITE_FIREBASE_APP_ID | из Firebase Console |

4. Deploy → готово

## Firebase Firestore rules

В Firebase Console → Firestore → Rules вставь:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/data/{doc} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Установить как приложение

- **iPhone**: Safari → Поделиться → «На экран домой»
- **Mac**: Chrome → иконка установки в адресной строке
