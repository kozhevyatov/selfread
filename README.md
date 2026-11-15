# SelfRead

**Своя библиотека электронных книг и аудиокниг на домашнем сервере.** Читалка для EPUB, FB2, MOBI, PDF, DjVu и комиксов, плеер аудиокниг, полки, статусы чтения, цитаты, статистика и синхронизация места чтения между устройствами. Запускается одним Docker-контейнером: на NAS (Synology и т. п.), на домашнем сервере или на VPS.

[![Docker image](https://github.com/kozhevyatov/selfread/actions/workflows/docker.yml/badge.svg)](https://github.com/kozhevyatov/selfread/actions/workflows/docker.yml)
![Platforms](https://img.shields.io/badge/platform-amd64%20%7C%20arm64-blue)

![SelfRead — главная](docs/screenshots/home.jpg)

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/book.jpg" alt="Страница аудиокниги"></td>
    <td width="50%"><img src="docs/screenshots/reader.jpg" alt="Читалка и её настройки"></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/folders.jpg" alt="Медиатека по папкам"></td>
    <td width="50%"><img src="docs/screenshots/mobile.jpg" alt="На телефоне"></td>
  </tr>
</table>

## Содержание

- [Возможности](#возможности)
- [Форматы](#форматы)
- [Установка через Docker Compose](#установка-через-docker-compose)
  - [1. SQLite — самый простой вариант](#1-sqlite--самый-простой-вариант)
  - [2. Существующая база MariaDB / MySQL](#2-существующая-база-mariadb--mysql)
  - [3. Всё в одном: сервис и база](#3-всё-в-одном-сервис-и-база)
- [Первый запуск](#первый-запуск)
- [Папки с книгами](#папки-с-книгами)
- [Переменные окружения](#переменные-окружения)
- [Обновление](#обновление)
- [Обратный прокси и HTTPS](#обратный-прокси-и-https)
- [Резервная копия](#резервная-копия)
- [Разработка](#разработка)
- [Лицензии](#лицензии)

## Возможности

### Библиотека
- **Медиатеки** — папки с книгами на сервере. Общая медиатека видна выбранным пользователям (чтение или чтение и запись). Личную видит только владелец: папка `<логин>/books` создаётся сама или выбирается на сервере.
- **Сканер** сам находит книги и аудиокниги, читает название, авторов, серию, год, аннотацию, жанры и обложку. Повторно читает только изменённые файлы. Запускается по расписанию, вручную или для одной папки.
- **Разделы:** все книги, электронные, аудиокниги, поиск по названию, автору, серии и чтецу. Есть фильтры по статусу и формату и сортировка: новые, по названию, автору, серии, году, папкам.
- **Папки** — навигация по медиатекам как в проводнике. Путь сверху, подпапки со счётчиком книг и аудиокниг, книги плитками или списком. Аудиокнигу можно включить, а книгу открыть в читалке прямо из папки. Карточка «Продолжить» показывает последнюю начатую книгу в папке. Есть поиск внутри папки и пересканирование одной папки.
- **Полки:** личные и общие (видны всем, менять может владелец).
- **Статусы:** «хочу прочитать», «читаю», «прочитано», «брошено»; оценка от 1 до 5; прогресс.
- **Карточка книги:** правка названия, авторов, серии, года, аннотации, жанров и обложки (файлом или ссылкой). Данные и обложки можно найти в Google Books и Open Library. Исправленное вручную сканер больше не перезаписывает.
- **Загрузка из браузера:** файлы или целые папки перетаскиванием, в личную медиатеку или в общую с правом записи, можно сразу на полку. После загрузки медиатека сканируется сама.
- **Calibre:** `metadata.opf` и `cover.jpg` рядом с книгой подхватываются.

### Читалка
- Движок [foliate-js](https://github.com/johnfactotum/foliate-js): EPUB, FB2, FBZ, MOBI, AZW3, PDF, CBZ. Отдельно поддерживаются TXT (UTF-8 и Windows-1251, главы находятся сами), HTML и DjVu (сервер отдаёт страницы картинками).
- DOCX, ODT, RTF и CHM сервер один раз конвертирует в EPUB, CBR и CB7 — в CBZ.
- Темы страницы (день, сепия, серый, ночь, лес), 7 шрифтов или «как в книге», размер, межстрочный интервал, поля, ширина колонки, одна или две колонки, страницы или прокрутка, выравнивание, переносы.
- Оглавление, поиск по книге, ползунок прогресса. Листать можно клавишами, свайпом или касанием края. Есть полноэкранный режим.
- **Цитаты и заметки:** выделите текст — появится панель с цветами, «Заметкой» и «Копировать»; цитаты подсвечиваются в тексте. **Закладки** ставятся из верхней панели. Всё собрано в отдельном разделе «Цитаты и закладки».
- Место чтения хранится на сервере: начали на телефоне — продолжаете на компьютере с той же страницы.
- Скрипты внутри книг не выполняются: страница читалки отдаётся с политикой безопасности (CSP).

### Аудиокниги
- Аудиокнига — это папка с MP3, M4A, OGG, OPUS или FLAC (подпапки `CD1`, `Disc 2` склеиваются в одну книгу) или один `.m4b` с главами.
- Мини-плеер внизу экрана и полноэкранный плеер, список глав, скорость от 0,75× до 3×, перемотка на ±15 и 30 секунд.
- Таймер сна: на N минут или до конца главы, звук плавно затихает.
- Закладки, управление с экрана блокировки телефона, место прослушивания хранится на сервере.

### Статистика
- Время чтения и прослушивания по дням (календарь) и по месяцам, серия дней подряд.
- Цель «N книг в год», прочитанное за год, книги, на которые ушло больше всего времени.

### Без интернета
- «Скачать на устройство» сохраняет книгу или аудиокнигу в браузере (раздел «На устройстве»), и она открывается без связи.
- Прогресс, закладки и время чтения копятся и уходят на сервер, когда связь вернётся.

### Пользователи и оформление
- Мастер первого запуска: база данных → администратор → медиатеки.
- Открытая или закрытая регистрация. Пользователями, доступом к медиатекам и расписанием сканирования управляет администратор.
- Три палитры интерфейса: «Бумага», «Библиотека», «Чернила». Есть автопереключение дневной и ночной темы.
- PWA: устанавливается на телефон как приложение.
- Защита от перебора паролей; токены входа с обновлением.

## Форматы

| Что | Форматы |
|---|---|
| Читаются в браузере | EPUB, FB2, FB2.ZIP / FBZ, MOBI, AZW, AZW3, PDF, DjVu, CBZ, TXT, HTML |
| Конвертируются при первом открытии | DOCX, ODT, RTF, CHM → EPUB; CBR, CB7 → CBZ |
| Метаданные из файла | EPUB, FB2, FBZ, MOBI, AZW, AZW3, PDF, DjVu, CBZ, MP3, M4A, M4B, OGG, OPUS, FLAC |
| По имени файла | остальные; понимает вид `Автор - Название.fb2` |
| Аудио | MP3, M4A, M4B (с главами), OGG, OPUS, FLAC, AAC, WAV |

Одинаковые имена в одной папке (`Книга.epub` + `Книга.fb2`) — это одна книга в нескольких форматах. DOC не поддерживается (нужен LibreOffice).

## Установка через Docker Compose

Готовый образ собирается на GitHub для `linux/amd64` и `linux/arm64`:

```
ghcr.io/kozhevyatov/selfread:latest
```

Собирать проект у себя не нужно. Выберите один из трёх вариантов, скопируйте пример из папки [`samples/`](samples) в отдельную папку на сервере под именем `docker-compose.yml`, поправьте пути к книгам и запустите:

```bash
docker compose up -d
```

Сервис откроется на `http://<адрес-сервера>:1334`.

### 1. SQLite — самый простой вариант

База — файл в `./data`, отдельный сервер базы данных не нужен. Подходит для домашней библиотеки на несколько человек.

Пример: [`samples/docker-compose.sqlite.yml`](samples/docker-compose.sqlite.yml)

```yaml
services:
  selfread:
    image: ghcr.io/kozhevyatov/selfread:latest
    container_name: selfread
    restart: unless-stopped
    ports:
      - "1334:1334"
    volumes:
      - ./data:/data
      - ./media:/uploads
      - /path/to/books:/library/books:ro
      - /path/to/audiobooks:/library/audiobooks:ro
    environment:
      TZ: Europe/Moscow
      DATABASE_URL: "sqlite:////data/selfread.db"
```

### 2. Существующая база MariaDB / MySQL

Если на сервере уже работает MariaDB или MySQL. Сначала создайте базу и пользователя:

```sql
CREATE DATABASE selfread CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'selfread'@'%' IDENTIFIED BY 'PASSWORD';
GRANT ALL PRIVILEGES ON selfread.* TO 'selfread'@'%';
```

Пример: [`samples/docker-compose.external-db.yml`](samples/docker-compose.external-db.yml)

```yaml
services:
  selfread:
    image: ghcr.io/kozhevyatov/selfread:latest
    container_name: selfread
    restart: unless-stopped
    ports:
      - "1334:1334"
    volumes:
      - ./data:/data
      - ./media:/uploads
      - /path/to/books:/library/books:ro
      - /path/to/audiobooks:/library/audiobooks:ro
    environment:
      TZ: Europe/Moscow
      DATABASE_URL: "mysql+pymysql://selfread:PASSWORD@host.docker.internal:3306/selfread?charset=utf8mb4"
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Какой хост указать в `DATABASE_URL`:
- база установлена на этом же сервере (не в Docker) — `host.docker.internal`;
- база в другом контейнере — имя этого контейнера; оба контейнера должны быть в одной сети Docker (в примере есть закомментированный блок `networks`);
- база на другой машине — её IP или доменное имя.

Спецсимволы в пароле нужно записать %-кодами: `@` → `%40`, `:` → `%3A`, `/` → `%2F`.

### 3. Всё в одном: сервис и база

SelfRead и MariaDB в одном файле: база поднимается вместе с сервисом, SelfRead ждёт, пока она будет готова.

Пример: [`samples/docker-compose.full.yml`](samples/docker-compose.full.yml) и [`samples/.env.example`](samples/.env.example).

```bash
mkdir selfread && cd selfread
curl -o docker-compose.yml https://raw.githubusercontent.com/kozhevyatov/selfread/main/samples/docker-compose.full.yml
curl -o .env https://raw.githubusercontent.com/kozhevyatov/selfread/main/samples/.env.example
nano .env            # пароли базы и пути к книгам
docker compose up -d
```

`.env`:

```env
TZ=Europe/Moscow
SELFREAD_PORT=1334
BOOKS_DIR=/path/to/books
AUDIOBOOKS_DIR=/path/to/audiobooks
DB_PASSWORD=change-me
DB_ROOT_PASSWORD=change-me-too
```

Файлы базы лежат в `./mariadb`.

## Первый запуск

1. Откройте `http://<адрес-сервера>:1334` — запустится мастер настройки.
2. **База данных.** Если `DATABASE_URL` задан в compose, шаг пропускается. Иначе выберите SQLite или укажите MariaDB.
3. **Администратор:** логин, email, пароль.
4. **Медиатеки:** выберите папки внутри `/library` (их можно добавить и позже в «Управлении»). Сканирование начнётся само.

Без `SETUP_TOKEN` мастер открывается только из локальной сети. Если сервер сразу доступен из интернета, задайте `SETUP_TOKEN` — мастер попросит ввести его.

## Папки с книгами

Всё, что смонтировано внутрь `/library`, видно в обзоре папок при создании медиатеки:

```yaml
volumes:
  - /volume1/books:/library/books:ro
  - /volume1/audiobooks:/library/audiobooks:ro
  - /volume1/comics:/library/comics:ro
```

- `:ro` — только чтение: файлы не изменятся, а загрузка из браузера в эту папку будет недоступна. Уберите `:ro`, если загружать туда книги через SelfRead нужно.
- `/uploads` — здесь создаются личные медиатеки пользователей (`<логин>/books`), он должен быть доступен на запись.
- Чтобы новые файлы принадлежали вашему пользователю, а не root, добавьте `user: "1000:1000"` (uid:gid — команда `id`).

Удобная раскладка для аудиокниг:

```
audiobooks/
├── Автор/
│   ├── Книга 1/            ← папка с mp3 = одна аудиокнига
│   │   ├── 01.mp3
│   │   └── cover.jpg
│   └── Книга 2/
│       ├── CD1/            ← CD1, CD2 склеиваются в одну книгу
│       └── CD2/
└── Другая книга.m4b        ← .m4b с главами = одна аудиокнига
```

## Переменные окружения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `DATABASE_URL` | — | `sqlite:////data/selfread.db` или `mysql+pymysql://user:pass@host:3306/selfread?charset=utf8mb4`. Если задана, мастер не спрашивает про базу |
| `SETUP_TOKEN` | — | Токен для мастера первого запуска, если он открыт не из локальной сети |
| `SECRET_KEY` | создаётся в `/data/secret.key` | Секрет для токенов входа |
| `TZ` | UTC | Часовой пояс (статистика по дням, расписание сканирования) |
| `ACCESS_TOKEN_MINUTES` | `15` | Время жизни токена доступа |
| `REFRESH_TOKEN_DAYS` | `30` | Сколько дней помнить вход («Запомнить меня») |
| `COOKIE_SECURE` | `auto` | Secure-флаг cookie: `auto` — по схеме запроса (за HTTPS-прокси будет secure) |
| `FORWARDED_ALLOW_IPS` | локальные сети | От каких адресов принимать `X-Forwarded-*` (реальный IP за прокси) |

Тома:

| Путь в контейнере | Что там |
|---|---|
| `/data` | база SQLite, ключ, настройки, обложки, кэш страниц и конвертаций |
| `/uploads` | личные медиатеки пользователей |
| `/library/...` | ваши папки с книгами |

## Обновление

```bash
docker compose pull
docker compose up -d
```

Изменения схемы базы применяются автоматически при запуске. Вместо `latest` можно закрепить версию: `ghcr.io/kozhevyatov/selfread:1.2`.

## Обратный прокси и HTTPS

Направьте домен (например, `read.example.com`) на `http://<сервер>:1334`. WebSocket не нужен. Если прокси работает не в локальной сети и не в сети Docker, добавьте его адрес в `FORWARDED_ALLOW_IPS`.

Nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:1334;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 2g;   # загрузка книг из браузера
}
```

## Резервная копия

Достаточно сохранить папку `data` (и `mariadb` или дамп базы, если используете MariaDB). Обложки и кэш восстановятся пересканированием, но правки карточек, полки, цитаты и прогресс хранятся в базе.

## Разработка

Стек: FastAPI + SQLAlchemy/Alembic (Python 3.12), React 19 + Vite + Tailwind CSS 4.

```bash
# бэкенд
cd backend && pip install -r requirements.txt
DATA_DIR=../data MEDIA_ROOT=../books UPLOAD_ROOT=../media uvicorn app.main:app --reload --port 1334

# фронтенд
cd frontend && npm install && npm run dev   # http://localhost:5173, API проксируется на 1334
```

Для обложек PDF и DjVu нужны `pdftoppm` (poppler) и `ddjvu` (djvulibre), для конвертации — `pandoc`, `bsdtar`/`unar`, `extract_chmLib`. В Docker-образе всё это есть.

Собрать образ локально:

```bash
docker build -t selfread .
```

Образ на GitHub собирает workflow [`.github/workflows/docker.yml`](.github/workflows/docker.yml): на каждый push в `main` он публикует тег `latest`, на тег `v1.2.3` — теги `1.2.3` и `1.2`.

## Лицензии

- Читалка использует [foliate-js](https://github.com/johnfactotum/foliate-js) (MIT) и [PDF.js](https://github.com/mozilla/pdf.js) (Apache-2.0) — лежат в `frontend/public/foliate`.
