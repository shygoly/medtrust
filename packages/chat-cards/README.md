# @medtrust/chat-cards

对话式任务配置的 **Card Message** 组件库。两个入口分离，避免后端被 React 依赖污染：

| 入口 | 内容 | 依赖 |
|------|------|------|
| `@medtrust/chat-cards` | Card 类型、字段校验、Card 抽取/提交编解码（纯 TS） | 无 |
| `@medtrust/chat-cards/react` | `CardRenderer` 与 Form/Status/Result/Confirm 卡片、字段组件 | react |

```ts
import { extractCardMessages, parseCardSubmission, type CardMessage } from '@medtrust/chat-cards';
import { CardRenderer } from '@medtrust/chat-cards/react';
```

## Card 协议

LLM 在文本里用围栏块输出卡片：

```
```card
{ "type": "form", "title": "外部对照配置", "fields": [ ... ] }
```
```

前端提交时把表单值包成提交信封回灌对话：

```
[card:submit] {"kind":"card-submit","cardType":"form","title":"外部对照配置","scenario":"external-control","values":{...}}
```
