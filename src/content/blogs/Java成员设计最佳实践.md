---
title: Java 成员设计最佳实践
description: Java Member Design Best Practices
pubDate: 2025-12-14
category: 技术向
toc: true
search: true
---

## 两类成员（静态&非静态）

| 特性     | 非静态 (实例成员)            | 静态 (`static` 成员)                     |
| -------- | ---------------------------- | ---------------------------------------- |
| 归属     | 属于对象 (Instance)          | 属于类 (Class)                           |
| 内存     | 每个对象都有一份拷贝         | 内存中只有一份拷贝                       |
| 调用方式 | `obj.method()` / `obj.field` | `ClassName.method()` / `ClassName.field` |
| 依赖关系 | 必须先 `new` 对象才能用      | 类加载时就存在，无需 `new`               |
| 访问权限 | 可以访问静态和非静态成员     | 只能访问静态成员 (不能直接访问非静态)    |

## 访问修饰符 (Access Modifiers) 速查

| 修饰符          | 可见范围    | **推荐默认策略**  | **典型用途**                                                 |
| --------------- | ----------- | ----------------- | ------------------------------------------------------------ |
| **`private`**   | 仅本类      | **👑 默认首选**    | 所有内部实现细节（字段、 helper 方法、内部类）。除非有理由公开，否则全私有的。 |
| **`public`**    | 全世界      | **谨慎使用**      | 对外暴露的 API 接口、常量 (`public static final`)、入口方法 (`main`)。 |
| **(default)**   | 同包        | **框架/测试专用** | 当你在写一个库，希望同包下的测试类或辅助类能访问，但不想暴露给外部用户时。 |
| **`protected`** | 子类 + 同包 | **继承专用**      | 当你设计一个类**专门为了被继承**，且子类需要重写或访问某些成员时（如 `JComponent`）。 |

## 1、内部类 (Nested Classes)

| 场景特征                                                     | **推荐写法**           | **理由**                                                     | **反例（不要这样做）**                                       |
| ------------------------------------------------------------ | ---------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| **纯数据结构/实现细节** (如链表节点、树节点、Map.Entry)      | `private static class` | **最常用**。完全封装，不依赖外部对象，内存开销小，静态方法可访问。 | `class Node` (非静态): 每个节点都持有一个多余的外部链表引用，浪费内存且无法在静态方法中使用。 |
| **构建器模式 (Builder)** (如 `StringBuilder`, `AlertDialog.Builder`) | `public static class`  | 需要让外部用户通过 `Outer.Builder` 来构建对象，且构建过程通常不需要先创建 `Outer` 实例。 | `private`: 外部无法使用。 `非静态`: 用户必须先 `new Outer()` 才能 `new Builder()`，逻辑荒谬。 |

> **💡 黄金法则**：定义内部类时，**默认先加 `static`**。只有当你发现代码里必须写 `OuterClass.this.variable` 时，再去掉 `static`。

## 2、成员变量 (Fields)

| 场景特征                                | **推荐写法**          | **理由**                                                     | **例子**                              |
| --------------------------------------- | --------------------- | ------------------------------------------------------------ | ------------------------------------- |
| **对象独有状态** (每个对象数据不同)     | `private` (非静态)    | **95% 的情况**。 encapsulation（封装），每个对象维护自己的状态。 | `String name`, `int age`, `Node head` |
| **全局共享常量** (所有对象共用，不可变) | `public static final` | 节省内存，语义明确，直接通过类名访问。                       | `Math.PI`, `Integer.MAX_VALUE`        |

> **💡 黄金法则**：**默认全是 `private` (非静态)**。只有确定是“常量”或“全局共享状态”时，才加 `static`。

## 3、成员方法 (Methods)

| 场景特征                                        | **推荐写法**                 | **理由**                                             | **例子**                                                |
| ----------------------------------------------- | ---------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| **操作对象状态** (需要读写 `this` 的成员变量)   | `public` / `private`(非静态) | **绝大多数业务逻辑**。需要知道“是谁”在调用。         | `list.add()`, `user.getName()`, `node.getNext()`        |
| **纯工具函数** (不依赖任何成员变量，只依赖参数) | `public static`              | 无需创建对象即可调用，性能稍好，语义清晰（工具类）。 | `Math.abs()`, `Collections.sort()`, `printLinkedList()` |
| **工厂方法** (用于创建对象，替代构造函数)       | `public static`              | 可以返回子类实例，或者进行复杂的创建逻辑。           | `LocalDate.now()`, `Optional.of()`                      |
| **访问静态变量** (仅操作 static 字段)           | `public static`              | 必须用静态方法操作静态变量（除非传入对象引用）。     | `getInstance()`, `getCount()`                           |

> **💡 黄金法则**：写方法时，问自己：**“这个方法需要用到 `this` 吗？”**
>
> - 需要 →→ **非静态**。
> - 不需要（只看参数） →→ **`static`**。

## 综合实战演练：设计一个 `User` 类

假设我们要设计一个用户类，包含用户名、密码，需要一个工具方法验证密码强度，还需要一个内部类来处理用户的地址信息。

```java
public class User {
    // 1. 成员变量：默认 private 非静态 (每个用户不同)
    private String username;
    private String password;
    
    // 2. 成员变量：private static (全局统计在线人数)
    private static int onlineCount = 0;

    // 3. 构造方法：public (对外公开创建)
    public User(String username, String password) {
        this.username = username;
        this.password = password;
        onlineCount++; // 访问静态变量
    }

    // 4. 成员方法：public 非静态 (操作当前用户数据)
    public String getUsername() {
        return username;
    }

    // 5. 成员方法：private 非静态 (内部辅助逻辑，依赖当前用户密码)
    private void encryptPassword() {
        // 加密逻辑...
    }

    // 6. 成员方法：public static (工具方法，不依赖具体用户对象)
    // 只要给一个字符串，就能判断强弱，不需要 new User()
    public static boolean isStrongPassword(String pwd) {
        return pwd.length() > 8; 
    }
    
    // 7. 成员方法：public static (获取静态变量)
    public static int getOnlineCount() {
        return onlineCount;
    }

    // 8. 内部类：private static (实现细节，不依赖 User 实例)
    // 地址只是数据，不需要访问 User 的 password 等隐私
    private static class Address {
        private String city;
        private String street;
        
        Address(String city, String street) {
            this.city = city;
            this.street = street;
        }
    }
    
    // 如果 Address 需要访问 User 的 username (比如打印 "张三住在...")
    // 那就去掉 static，变成 private class Address
}
```

## 总结口诀

1. **内部类**：默认 `private static`，非要访问外部 `this` 才去掉 `static`。
2. **变量**：默认 `private`，全局常量加 `static final`。
3. **方法**：不用 `this` 就加 `static`。
4. **权限**：默认 `private`，非要给别人用才 `public`。
