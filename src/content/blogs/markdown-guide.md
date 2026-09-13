---
title: Markdown Guide
description: A compact reference page for checking Markdown rendering in this site
pubDate: 2025-12-02
lastModDate: ''
toc: true
search: true
---

This page is kept as a lightweight regression sample for the blog renderer. It helps verify headings, lists, tables, code blocks, images, math, links, and footnotes after template changes.

## An h1 header

Paragraphs are separated by a blank line.

2nd paragraph. *Italic*, **bold**, and `monospace`. Itemized lists look like:

- this one
- that one
- the other one

Note that — not considering the asterisk — the actual text content starts at 4-columns in.

> Block quotes are written like so.
>
> They can span multiple paragraphs, if you like.

Use 3 dashes for an em-dash. (ex., "she was late—traffic was terrible").

Use 2 dashes for ranges (ex., "it's all in chapters 12--14").

Three dots … will be converted to an ellipsis.

Unicode is supported. 😊

### An h2 header

Here's a numbered list:

1. first item
2. second item
3. third item

Note again how the actual text starts at 4 columns in (4 characters from the left side). 

Here's a code sample:

    # Let me re-iterate ...
    for i in 1 .. 10 { do-something(i) }

As you probably guessed, indented 4 spaces. By the way, instead of indenting the block, you can use delimited blocks, if you like:

```
define foobar() {
    print "Welcome to flavor country!";
}
```

(which makes copying & pasting easier). 

#### An h3 header

Now a nested list:

1. First, get these ingredients:

    - carrots
    - celery
    - lentils

2. Boil some water.
3. Dump everything in the pot and follow
    this algorithm:

        find wooden spoon
        uncover pot
        stir
        cover pot
        balance wooden spoon precariously on pot handle
        wait 10 minutes
        goto first step (or shut off burner when done)

    Do not bump wooden spoon or it will fall.

Notice again how text always lines up on 4-space indents (including that last line which continues item 3 above).

Here's a link to [google](https://www.google.com/) and to a [section heading in the current doc](#an-h2-header).

## Link to other blog posts

To link to another blog post in this project, use the final page route instead of the source file path.

- Same level posts under `src/content/blogs/`:
  - [My Mac Setup](/blogs/我的mac配置清单/)
  - [My vibe coding workflow](/blogs/我的vibe coding流程/)
- Nested posts under a subfolder:
  - [JUC multithreading basics](/blogs/JUC并发编程/JUC并发编程——多线程基础/)
  - [JUC memory model and synchronization](/blogs/JUC并发编程/JUC并发编程——Java内存模型与底层同步机制/)

Use this pattern:

```md
[Link text](/blogs/slug/)
[Link text](/blogs/folder/slug/)
```

Do not use source paths like `src/content/blogs/foo.md` or relative file links like `./foo.md`.

Here's a footnote [^1].

[^1]: Footnote text goes here.

Tables can look like this:

| size | material    | color       |
| ---- | ----------- | ----------- |
| 9    | leather     | brown       |
| 10   | hemp canvas | natural     |
| 11   | glass       | transparent |

A horizontal rule follows.

***

Here's a image can be specified like so:

![example image](/vue.png "An exemplary image")

Inline math equations go in like so: $\omega = d\phi / dt$. 

Display math should get its own line and be put in in double-dollarsigns:

$$I = \int \rho R^{2} dV$$

And note that you can backslash-escape any punctuation characters which you wish to be displayed literally, ex.: \`foo\`, \*bar\*, etc.

Here’s a final look at how the inline code appears: `console.log("hello world!")`. 👋
