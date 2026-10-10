# Политика конфиденциальности Open Inventory Helper

_Действует с 10 октября 2026 года. English version below._

У Open Inventory Helper нет своего сервера, рекламы и аналитики. Разработчик не получает никаких данных пользователей.

## Какие данные обрабатываются и куда уходят

Расширение работает на страницах steamcommunity.com и store.steampowered.com. Запросы уходят напрямую из вашего браузера в перечисленные сервисы и только для работы функций:

| Куда | Что отправляется | Зачем |
|---|---|---|
| steamcommunity.com | запросы цен и действия (продажа, покупка, обмен) от имени вашей открытой сессии Steam | цены Торговой площадки и действия, которые вы запускаете сами |
| api.augmentedsteam.com | id игр, DLC и наборов на открытой странице магазина, код страны магазина, код валюты | исторические минимумы и курсы валют |
| api.isthereanydeal.com (если вы сохранили ключ) | ваш ключ IsThereAnyDeal, id игры, код страны магазина | график истории цен |
| Skinport, Market.CSGO (TM), Waxpeer (если вы включили источник) | id игры и валюта | прайс-лист площадки |

Пароль Steam, Steam Guard и cookie сессии расширение не читает и никуда не передаёт.

## Что хранится

Настройки, ключ IsThereAnyDeal и кэш цен хранятся только в вашем браузере (`chrome.storage`). Историю посещённых страниц расширение не ведёт. Кэш можно очистить в настройках («Цены → Сохранённые цены»), а всё остальное удаляется вместе с расширением.

## Передача третьим лицам

Расширение не продаёт и не передаёт данные. На сервисы из таблицы распространяются их собственные политики конфиденциальности.

## Контакты

Вопросы задавайте в Issues репозитория: <!-- TODO: ссылка на репозиторий -->

---

# Privacy Policy (English)

_Effective October 10, 2026._

Open Inventory Helper has no server, ads or analytics. The developer receives no user data.

The extension works on steamcommunity.com and store.steampowered.com. Requests go directly from your browser to these services, only to provide its features:

- **steamcommunity.com**: price requests and the actions you start yourself (selling, buying, trades), made with your open Steam session.
- **api.augmentedsteam.com**: ids of the games, DLC and packages on the open store page, the store country code and the currency code (historical lows, exchange rates).
- **api.isthereanydeal.com**, only if you saved a key: your IsThereAnyDeal key, the game id and the store country code (price history chart).
- **Skinport, Market.CSGO (TM), Waxpeer**, only if you enabled the source: the game id and the currency (marketplace price lists).

The extension never reads or sends your Steam password, Steam Guard codes or session cookies. Settings, the IsThereAnyDeal key and cached prices are stored only in your browser (`chrome.storage`). No browsing history is kept. The extension does not sell or share data; the services above follow their own privacy policies.
