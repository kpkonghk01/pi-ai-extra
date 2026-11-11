# Volcengine Ark: Seedream image size (`size`)

> Extract of the `size` parameter of the Ark image generation API (Seedream 5.0 pro / Seedream 5.0 flash, image generation), fetched 2026-11-11 from https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh . The page renders its tables in HTML; the rows below are copied cell by cell, without change (an empty first cell continues the resolution above it).
>
> The page does not list Seedream 5.5 yet. ToAPIs documents the same `size` rules for `doubao-seedream-5-5` (1K / 1.5K / 2K tiers, or explicit pixels within [921600, 4624220] and an aspect ratio within [1/16, 16]), so the toapis package sends an explicit aspect ratio as the pixels this table maps it to.

Seedream 5.0 pro / Seedream 5.0 flash（图片生成场景）
支持以下两种方式，不可混用：
方式 1（推荐）：指定分辨率档位，并在 prompt 中用自然语言描述图片宽高比、图片形状或图片用途，最终由模型判断生成图片的大小。
默认值：2K
可选值：1K、1.5K、2K
价格说明
1.5K 与 1K 价格相同（详情参见 模型价格），且图片生成效果更优。
方式 2：指定宽高像素值（宽x高）。
总像素取值范围：[1280x720（921600）, 2048x2048x1.1025（4624220）]
宽高比取值范围：[1/16, 16]
说明
采用方式 2 时，需同时满足总像素取值范围和宽高比取值范围。其中，总像素是对单张图宽度和高度的像素乘积限制，而不是对宽度或高度的单独值进行限制。
有效示例：2048x1024。总像素值 2048x1024=2097152，符合 [921600, 4624220] 的区间要求；宽高比 2048/1024=2，符合 [1/16, 16] 的区间要求，故该示例值有效。
无效示例：512x512。总像素值 512x512=262144，未达到 921600 的最低要求，故该示例值无效。
使用方式 1 时，模型实际映射的宽高像素参考值（不限于以下标准值，仅列常见）：

| 分辨率 | 宽高比 | 宽高像素值 |
| --- | --- | --- |
| 1K | 1:1 | 1024x1024 |
|  | 4:3 | 1152x864 |
|  | 3:4 | 864x1152 |
|  | 16:9 | 1424x800 |
|  | 9:16 | 800x1424 |
|  | 3:2 | 1248x832 |
|  | 2:3 | 832x1248 |
|  | 21:9 | 1568x672 |
| 1.5K | 1:1 | 1536x1536 |
|  | 4:3 | 1792x1344 |
|  | 3:4 | 1344x1792 |
|  | 16:9 | 2048x1152 |
|  | 9:16 | 1152x2048 |
|  | 3:2 | 1872x1248 |
|  | 2:3 | 1248x1872 |
|  | 21:9 | 2352x1008 |
| 2K | 1:1 | 2048x2048 |
|  | 4:3 | 2368x1776 |
|  | 3:4 | 1776x2368 |
|  | 16:9 | 2816x1584 |
|  | 9:16 | 1584x2816 |
|  | 3:2 | 2496x1664 |
|  | 2:3 | 1664x2496 |
|  | 21:9 | 3136x1344 |
