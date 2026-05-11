# DSL Feature Matrix

Compatibility target: `cicada-tg==0.3.3`.

| Feature | Studio block/API | Canonical parser/runtime | Compatibility gate |
| --- | --- | --- | --- |
| `бот`, `версия`, `команды` | builder roots | `cicada.parser.Program` config | parser parity |
| `при старте`, `при команде`, `при нажатии` | root handlers | `Handler(kind, trigger, body)` | parser + runtime parity |
| `при нажатии:` generic router | callback root with empty label | accepted by UI parser/codegen and core parser | parser parity |
| Reply buttons | `buttons` block | `Buttons` + adapter keyboard effects | runtime parity |
| Inline keyboard | `inline` block | `InlineKeyboard`, `InlineButton` | parser parity |
| Inline from DB | `inline_db` block | `inline из бд ...`, `text_field`, `id_field`, `callback_prefix` | parser parity + core guard |
| Media handlers | `on_photo`, `on_document`, `on_voice`, `on_sticker` | `MediaEvent` and media handler dispatch | preview parity |
| Contact/location | `on_contact`, `on_location` | `MediaEvent(media_type=...)` | adapter compatibility |
| Scenarios/steps | `scenario`, `step`, `ask`, `goto`, `stop` | scenario manager in runtime/executor | runtime parity |
| DB key/value | `save`, `get`, `save_global`, `all_keys`, `get_user` | `cicada.database` contract | parser parity |
| HTTP | `http_get/post/patch/put/delete`, headers | `RequestsHttpClient` and HTTP nodes | parser parity |
| Control flow | `если`, `иначе`, loops, switch | parser AST + executor dispatch | parser parity |
| Preview | preview chat panel | `cicada.preview_worker` | preview parity |

Legacy/obsolete:

- `@obsolete db_template_key`: quoted DB keys are literal in `cicada-tg==0.3.3`.
- `@obsolete scenario_ask_resume_after_media`: old Studio smoke expectation is not canonical.
