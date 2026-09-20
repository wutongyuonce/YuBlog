---
title: JUC 并发编程 1——多线程基础
description: JUC Concurrent programming——multithreaded foundation
pubDate: 2026-03-01
category: 技术向
lastModDate: ''
tags: [Java, JUC, 多线程]
toc: true
search: true
---

[【跳转到下一篇：JUC 并发编程 2—Java 内存模型与底层同步机制】](/blogs/juc并发编程/juc-并发编程-2java-内存模型与底层同步机制/)

## 一、基础

### 线程与进程

最初的计算机只能接受一些特定的指令，用户每输入一个指令，计算机就做出一个 操作。当用户在思考或者输入时，计算机就在等待。这样效率非常低下，在很多时候，计算机都处在等待状态。

后来有了**批处理操作系统**，把一系列需要操作的指令写下来，形成一个清单，一次性交给计算机。用户将多个需要执行的程序写在磁带上，然后交由计算机去读取并逐个执行这些程序，并将输出结果写在另一个磁带上。

批处理操作系统在一定程度上提高了计算机的效率，但是由于批处理操作系统的指令运行方式仍然是串行的，内存中始终只有一个程序在运行，后面的程序需要等待前面的程序执行完成后才能开始执行，而前面的程序有时会由于I/O操作、网络等原因阻塞，所以批处理操作效率也不高。

批处理操作系统的瓶颈在于内存中只存在一个程序，那么内存中能不能存在多个程序呢？于是**提出了进程**。 进程就是应用程序在内存中分配的空间，也就是正在运行的程序，各个进程之间互不干扰。同时进程保存着程序每一个时刻运行的状态。

<img src="/blogs/juc-img/GhrSTfNRsc2jFZM.jpg" alt="b040eadb-8aa1-4b2a-b587-2c0a6b4efa0b" style="zoom:67%;" />

使用**进程+CPU时间片轮转方式**的操作系统，在宏观上看起来同一时间段执行多个任务，换句话说，进程让操作系统的并发成为了可能。虽然并发从宏观上看有多个任务在执行，但在事实上，对于单核CPU来说，任意具体时刻都只有一个任务在占用CPU资源。

<img src="/blogs/juc-img/hUkGafu7vztB4qR.png" alt="image-20221004132729868" style="zoom: 67%;" />

在早期的计算机中，进程是拥有资源和独立运行的最小单位，也是程序执行的最小单位。但是，如果我希望两个任务同时进行，就必须运行两个进程，由于每个进程都有一个自己的内存空间，进程之间的通信就变得非常麻烦（比如要共享某些数据）而且执行不同进程会产生上下文切换，非常耗时，那么能否实现在一个进程中就能够执行多个任务呢？

<img src="/blogs/juc-img/okgq3HEKGn6jBVw.png" alt="image-20221004132700554" style="zoom: 67%;" />

于是提出了线程，一个进程可以有多个线程，线程是程序执行中一个单一的顺序控制流程，现在线程才是程序执行流的最小单元，各个线程之间共享程序的内存空间（也就是所在进程的内存空间），上下文切换速度也高于进程。

总之，进程和线程的提出极大的提高了操作系统的性能。**进程让操作系统的并发性成为了可能，而线程让进程的内部并发成为了可能。**

> **多进程的方式也可以实现并发，为什么我们要使用多线程？**
>
> 多进程方式确实可以实现并发，但使用多线程，有以下几个好处：
>
> - 进程间的通信比较复杂，而线程间的通信比较简单，通常情况下，我们需要使用共享资源，这些资源在线程间的通信比较容易。
> - 进程是重量级的，而线程是轻量级的，故多线程方式的系统开销更小。

> **进程和线程的区别**
>
> 进程是一个独立的运行环境，而线程是在进程中执行的一个任务。他们两个本质的区别是**是否单独占有内存地址空间及其它系统资源**（比如I/O）：
>
> - 进程单独占有一定的内存地址空间，所以进程间存在内存隔离，数据是分开的，数据共享复杂但是同步简单，各个进程之间互不干扰；而线程共享所属进程占有的内存地址空间和资源，数据共享简单，但是同步复杂。
> - 进程单独占有一定的内存地址空间，一个进程出现问题不会影响其他进程，不影响主程序的稳定性，可靠性高；一个线程崩溃可能影响整个程序的稳定性，可靠性较低。
> - 进程单独占有一定的内存地址空间，进程的创建和销毁不仅需要保存寄存器和栈信息，还需要资源的分配回收以及页调度，开销较大；线程只需要保存寄存器和栈信息，开销较小。
>
> 另外一个重要区别是，**进程是操作系统进行资源分配的基本单位，而线程是操作系统进行调度的基本单位，即CPU分配时间的单位**。

### 上下文切换

**上下文切换**（有时也称做进程切换或任务切换）是指 **CPU 从一个进程（或线程） 切换到另一个进程（或线程）**。

**上下文**是指**某一时间点 CPU 寄存器和程序计数器的内容**。

- **寄存器**是cpu内部的少量的速度很快的闪存，通常存储和访问计算过程的中间值提高计算机程序的运行速度。
- **程序计数器**是一个专用的寄存器，用于表明指令序列中 CPU 正在执行的位置，存的值为正在执行的指令的位置或者下一个将要被执行的指令的位置，具体实现依赖于特定的系统。
- 举例说明：线程A - B
  1. 先挂起线程A，将其在cpu中的状态保存在内存中；
  2. 在内存中检索下一个线程B的上下文并将其在 CPU 的寄存器中恢复，执行B线程；
  3. 当B执行完，根据程序计数器中指向的位置恢复线程A。

CPU通过为每个线程分配**CPU时间片**来实现多线程机制。CPU通过时间片分配算法来循环执行任务，当前任务执行一个时间片后会切换到下一个任务。

但是，在切换前会保存上一个任务的状态，以便下次切换回这个任务时，可以再加载这个任务的状态。所以任务从保存到再加载的过程就是一次上下文切换。

上下文切换通常是计算密集型的，意味着此操作会消耗大量的 CPU 时间，故线程也不是越多越好。如何减少系统中上下文切换次数，是提升多线程性能的一个重点课题。

### 并发与并行

1、**顺序执行**实际上就是我们同一时间只能处理一个任务，所以需要前一个任务完成之后，才能继续下一个任务，依次完成所有任务。

2、**并发执行**也是同一时间只能处理一个任务，但是可以每个任务轮着做（时间片轮转）。

3、**并行执行**就突破了同一时间只能处理一个任务的限制，同一时间可以做多个任务。

比如要进行一些排序操作，就可以用到并行计算，只需要等待所有子任务完成，最后将结果汇总即可。包括分布式计算模型MapReduce，也是采用的并行计算思路。

> - **并发（Concurrency）** 的核心特征：
>   - **微观串行**：在任意**一个瞬间**，CPU（尤其是单核）只能执行**一条指令**，多个线程/任务是**交替执行**的（通过时间片轮转、上下文切换）。
>   - **宏观并行**：从用户或程序整体视角看，多个任务**似乎同时在运行**（比如一边下载文件一边播放音乐）。
> - 多核CPU下，每个核(core)都可以调度运行线程，这时候线程可以是并行的。
>
> ***注意：并发≠并发调用***

### 应用

1、**多线程可以让方法执行变为异步调用**，但不代表单线程就不能实现异步，只是比较麻烦。

- **同步 Synchronous 调用**：调用方（主线程）**阻塞等待**结果返回后才继续执行
- **异步 Asynchronous 调用**：调用方（主线程）**不等待**结果，立即返回，后续通过回调、事件、Future 等方式获取结果

| 组合       | 示例                                                     |
| -------- | ------------------------------------------------------ |
| 单线程的同步调用 | 普通方法调用                                                 |
| 单线程的异步调用 | JavaScript **事件循环（Event Loop） + 回调队列（Callback Queue）** |
| 多线程的同步调用 | `synchronized` 方法被多个线程调用                               |
| 多线程的异步调用 | `CompletableFuture.supplyAsync()`                      |

Tomcat的异步servlet也是类似的目的，让用户线程处理耗时较长的操作，避免阻塞Tomcat的工作线程。

2、**提高效率**

- 在单核CPU下，多线程不能实际提高程序运行效率，只是为了能够在不同的任务之间切换，不同线程轮流使用CPU，不至于一个线程总占用CPU，导致别的线程没法干活
- 多核CPU可以并行跑多个线程，但能否提高程序运行效率还是要分情况的
  - 有些任务经过精心设计，将任务拆分，并行执行，可以提高程序的运行效率（比如计算一个大数组中每个元素的平方）；但并不是所有计算任务都能拆分（比如递推计算斐波那契数列第 n 项）
  > **阿姆达尔定律**：**系统的整体加速受限于不能被改进（或不能并行化）的部分所占的比例。**
  >
  > 换句话说，即使你把程序中可以并行的部分优化到极致（比如用无限多的处理器），程序的总运行时间仍然受制于那部分**必须串行执行**的代码。
- I/O操作不占用CPU，但是**几乎所有传统的I/O操作（包括磁盘读写、网络通信、终端输入等）都是** **`阻塞式IO`**，虽然线程不占用 CPU，但它被操作系统标记为不可运行 waiting，不能处理其他任务，**没能充分利用线程**。所以才有后面 **`非阻塞式IO`** **和** **`异步IO`** **的优化**（见网络编程文档）

### 查看进程、程序相关线程的方法

每个Java程序都有一个默认的主线程，就是通过JVM启动的第一个线程main线程。除此之外，还有很多其他线程比如**守护线程（Daemon）**，守护线程默认的优先级比较低。如果某线程是守护线程，那如果所有的非守护线程都结束了，这个守护线程也会自动结束。

- 在Windows环境下，tasklist 查看进程，taskkill 杀死进程

* Java 专属工具（JDK 自带）
  - `jps` 命令查看所有Java进程
  - `jstack <PID>` 查看某个Java进程(PID)的所有线程状态
  - `jconsole` 图形化监控工具，可连接本地/远程 JVM

**方法1：通过** **`Thread.getAllStackTraces().keySet()`** **获取线程对象**

```java
public class EmptyMain {
    public static void main(String[] args) throws InterruptedException {
        Thread.getAllStackTraces().keySet().forEach(t ->
        System.out.println(t.getName() + " | " + t.getThreadGroup() + " | daemon=" + t.isDaemon()));
    }
}
```

```bash
Reference Handler | java.lang.ThreadGroup[name=system,maxpri=10] | daemon=true
Common-Cleaner | java.lang.ThreadGroup[name=InnocuousThreadGroup,maxpri=10] | daemon=true
main | java.lang.ThreadGroup[name=main,maxpri=10] | daemon=false
Finalizer | java.lang.ThreadGroup[name=system,maxpri=10] | daemon=true
Signal Dispatcher | java.lang.ThreadGroup[name=system,maxpri=10] | daemon=true
Attach Listener | java.lang.ThreadGroup[name=system,maxpri=10] | daemon=true
```

`Thread.getAllStackTraces().keySet()` 返回的是 **真实的** **`Thread`** **对象集合**（`Set<Thread>`），**可以直接调用所有** **`Thread`** **的 public 方法**

1、`t.getName()` → **线程名称**

- 用户创建的线程：默认是 `"Thread-0"`, `"Thread-1"`...，也可自定义；
- JVM 系统线程：有固定命名，如：
  - `"main"`
  - `"Reference Handler"`
  - `"Finalizer"`
  - `"Signal Dispatcher"`
  - `"Common-Cleaner"`
  - `"C2 CompilerThread0"`（JIT 编译线程）
  - `"G1 Young RemSet Sampling"`（GC 线程）

2、`t.getThreadGroup()` → **线程组对象**

- 默认情况下，所有用户线程（包括 `main`）都属于 **`main`** **线程组**；
- 系统线程（如 GC、JIT 线程）通常属于 **`system`** **线程组**；
- 输出形式是对象的 `toString()`，例如：
  - `java.lang.ThreadGroup[name=main,maxpri=10]`
  - `java.lang.ThreadGroup[name=system,maxpri=10]`

> 🔍 `maxpri=10` 表示该线程组允许的最大优先级为 10（Java 线程优先级范围 1\~10）。

3、`t.isDaemon()` → **是否为守护线程**

- `daemon=true`：守护线程（后台服务线程，JVM 退出时不等待它）；
- `daemon=false`：用户线程（非守护线程，只要有一个存活，JVM 就不会退出）；
- **只有** **`main`** **线程和你显式创建的非守护线程是** **`false`**，其他几乎全是 `true`。

**方法2：通过** **`ThreadMXBean`** **获取线程信息**

```java
import java.lang.management.ManagementFactory;
import java.lang.management.ThreadMXBean;
import java.lang.management.ThreadInfo;

public class EmptyMain {
    public static void main(String[] args) {
        ThreadMXBean bean = ManagementFactory.getThreadMXBean();
        long[] ids = bean.getAllThreadIds();
        ThreadInfo[] infos = bean.getThreadInfo(ids);
        for (ThreadInfo info : infos) {
            System.out.println(info.getThreadName());
        }
    }
}
```

<img src="/blogs/juc-img/image-20260101125328508.png" alt="image-20260101125328508" style="zoom:50%;" />

| 方法                                    | 作用           |
| ------------------------------------- | ------------ |
| `ManagementFactory.getThreadMXBean()` | 获取 JVM 线程管理器 |
| `bean.getAllThreadIds()`              | 获取所有线程 ID    |
| `bean.getThreadInfo(ids)`             | 获取线程详细信息快照   |
| `info.getThreadName()`                | 获取线程名称       |

> 具体线程数量和名称可能因 **JVM 版本、GC 算法、操作系统、是否启用调试/JFR** 等略有不同。

## 二、Java多线程类和接口

![juc](/blogs/juc-img/juc.png)

### Thread类和Runnable接口

JDK提供了 Thread 类和 Runnable 接口来让我们实现自己的“线程”类。Thread 类是一个 Runnable 接口的实现类。

```java
@FunctionalInterface
public interface Runnable {
    /**
     * 当对象被用作线程的任务时，该方法会被线程调用。
     * 此方法中的代码将在新线程中执行。
     */
    public abstract void run();
}
```

查看 Thread 类的构造方法，发现其实是简单调用一个私有的 init 方法来实现初始化。

```java
public class Thread implements Runnable {
    // 线程名称前缀和编号计数器
    private static int threadInitNumber;
    private static synchronized int nextThreadNum() {
        return threadInitNumber++;
    }

    // 所属线程组
    private ThreadGroup group;

    // 要执行的 Runnable 任务
    private Runnable target;

    // 线程名称
    private String name;

    // 栈大小（0 表示使用默认值）
    private long stackSize;

    // 用于权限检查的上下文
    private AccessControlContext inheritedAccessControlContext;

    // ThreadLocal 相关的两个 map
    ThreadLocal.ThreadLocalMap threadLocals = null;
    ThreadLocal.ThreadLocalMap inheritableThreadLocals = null;

    // ------------------ 构造函数 ------------------

    public Thread(Runnable target) {
        init(null, target, "Thread-" + nextThreadNum(), 0);
    }

    // 其他构造函数略...

    // ------------------ init 方法（核心初始化逻辑）------------------

    private void init(ThreadGroup g, Runnable target, String name,
                      long stackSize, AccessControlContext acc,
                      boolean inheritThreadLocals) {
        if (name == null) {
            throw new NullPointerException("name cannot be null");
        }

        this.name = name;

        // 获取当前线程（父线程）
        Thread parent = currentThread();

        // 设置线程组
        SecurityManager security = System.getSecurityManager();
        if (g == null) {
            if (security != null) {
                g = security.getThreadGroup();
            } else {
                g = parent.getThreadGroup();
            }
        }
        g.checkAccess(); // 安全检查

        this.group = g;
        this.target = target;
        this.priority = parent.getPriority(); // 继承优先级
        this.daemon = parent.isDaemon();      // 继承守护状态

        // 设置 AccessControlContext
        if (security == null || isCCLOverridden(getClass())) {
            this.inheritedAccessControlContext = acc != null ? acc : AccessController.getContext();
        } else {
            this.inheritedAccessControlContext = parent.inheritedAccessControlContext;
        }

        // 处理栈大小
        if (stackSize == 0) {
            stackSize = parent.stackSize;
        }
        this.stackSize = stackSize;

        // 处理 inheritableThreadLocals
        if (inheritThreadLocals && parent.inheritableThreadLocals != null) {
            this.inheritableThreadLocals =
                ThreadLocal.createInheritedMap(parent.inheritableThreadLocals);
        }

        // 将新线程加入线程组
        g.addUnstarted();
    }

    // init 的重载版本（供公共构造函数调用）
    private void init(ThreadGroup g, Runnable target, String name, long stackSize) {
        init(g, target, name, stackSize, null, true);
    }
}
```

init 的方法传入的变量：

- g：线程组，指定这个线程是在哪个线程组下；
- target：指定要执行的任务；
- name：线程的名字，多个线程的名字是可以重复的。如果不指定名字，则见构造函数；
- acc：用于初始化私有变量 inheritedAccessControlContext 。
- inheritThreadLocals：可继承的 ThreadLocal，Thread 类里面有两个私有属性来支持 ThreadLocal。

实际情况下大多是直接调用下面两个构造方法：

- Thread(Runnable target)
- Thread(Runnable target, String name)

#### 自定义线程类

1、继承 Thread 类，并重写 run 方法

```java
public class Demo {
    public static class MyThread extends Thread {
        @Override
        public void run() {
            System.out.println("MyThread");
        }
    }
    public static void main(String[] args) {
        Thread myThread = new MyThread();
        myThread.start();
    }
}
```

- 注意要调用 start() 方法后，该线程才算启动！
- 注意不可多次调用start()方法。在第一次调用start()方法后，再次调用start()方法会抛出IllegalThreadStateException异常。
- 在程序里面调用了start()方法后，虚拟机会先为我们创建一个线程，然后等到这个线程第一次得到时间片时再调用run()方法。

2、实现 Runnable 接口的 run 方法

Runnable 接口只有一个未实现方法 run，因此可以直接使用 Java 8 的lambda表达式来简化代码。

```java
public class Demo {
    public static class MyThread implements Runnable {
    @Override
        public void run() {
            System.out.println("MyThread");
        }
    }
    public static void main(String[] args) {
        new Thread(new MyThread()).start();
        // Java 8 函数式编程，可以省略MyThread类
        new Thread(() -> {
            System.out.println("Java 8 匿名内部类");
        }).start();
    }
}
```

#### Thread类常用方法（基于 Java21）

##### 一、线程控制与状态管理

1、`start()`

- **作用**：启动线程，JVM 调用该线程的 `run()` 方法。
- **注意**：**不能重复调用**，否则抛出 `IllegalThreadStateException`。
- 正确方式：
  ```
  Thread t = new Thread(() -> System.out.println("Hello"));
  t.start(); // 启动新线程
  ```

2、`run()`

- **作用**：线程执行体。通常由子类重写或传入 `Runnable`。
- **注意**：直接调用 `run()` **不会启动新线程**，只是普通方法调用！

3、`join()`, `join(long millis)`, `join(long millis, int nanos)`

- **作用**：**等待当前线程终止**。
  - `t.join()`：主线程阻塞，直到 `t` 执行完毕。
  - 带超时的版本：最多等待指定时间。
- **用途**：实现线程顺序执行或等待结果。
  ```java
  Thread t = new Thread(task);
  t.start();
  t.join(); // 主线程在此等待 t 结束
  ```

##### 二、线程中断（协作式取消）

4、`interrupt()`

- **作用**：**请求中断**该线程。
  - 若线程处于 `sleep()`, `wait()`, `join()` 等阻塞状态 → 抛出 `InterruptedException`，并清除中断状态。
  - 若线程在运行普通代码 → 仅设置**中断标志位**（`isInterrupted()` 返回 `true`）。
- **关键**：中断是**协作机制**，目标线程必须主动检查并响应。

5、`isInterrupted()`

- **作用**：**返回当前线程的中断状态**（不清除标志）。
- 实例方法：`thread.isInterrupted()`

6、`Thread.interrupted()`（静态方法！）

- **作用**：**返回当前线程的中断状态，并清除（重置为 false）**。
- ⚠️ 注意：这是**静态方法**，只作用于**当前线程**。
  ```java
  if (Thread.interrupted()) {
      // 中断被消费，后续 isInterrupted() 返回 false
  }
  ```

> 💡 **最佳实践**：捕获 `InterruptedException` 后，通常应恢复中断状态。
>
> 以下这段代码是 Java 并发编程中**处理线程中断的标准范式**，体现了“协作式中断”的核心思想：
>
> ```java
> try {
>  Thread.sleep(1000); // ① 当前线程休眠 1 秒
> } catch (InterruptedException e) { // ② 如果休眠被中断，会抛出此异常
>  Thread.currentThread().interrupt(); // ③ 恢复中断状态
>  return; // ④ 提前退出方法（或任务）
> }
> ```
>
> ❓为什么要恢复中断？
>
> - 中断是一种**跨方法/组件的协作信号**，可能由上层逻辑发起（如用户点击“取消”）。
> - 如果你在方法中“吞掉”了中断（不恢复），后续代码就**无法感知中断请求**，导致无法正确取消任务。
> - 恢复中断后，调用栈上层的代码仍可通过 `isInterrupted()` 或再次捕获 `InterruptedException` 来响应中断。
>
> * 除非你明确要“消费”中断（比如在最外层任务中处理取消逻辑），否则都应该恢复中断状态。

##### 三、线程休眠与让步

7、`sleep(long millis)`, `sleep(long millis, int nanos)`（静态方法）

- **作用**：**使当前线程暂停执行指定时间**，不释放锁。
- **注意**：
  - 是 `Thread` 的**静态方法**，总是作用于**当前线程**。
  - 可能抛出 `InterruptedException`。
  ```
  try {
      Thread.sleep(1000); // 当前线程睡 1 秒
  } catch (InterruptedException e) { ... }
  ```

8、`yield()`（静态方法）

- **作用**：**提示调度器**：当前线程愿意让出 CPU，给其他同优先级线程运行机会。
- **注意**：
  - 只是“建议”，JVM 可能忽略。
  - 不保证其他线程一定运行，也不释放锁。
  - 现代 JVM 中很少使用，效果不确定。

示例：

```java
public static void main(String[] args) {
    Thread t1 = new Thread(() -> {
        System.out.println("线程1开始运行！");
        for (int i = 0; i < 50; i++) {
            if(i % 5 == 0) {
                System.out.println("让位！");
                Thread.yield();
            }
            System.out.println("1打印："+i);
        }
        System.out.println("线程1结束！");
    });
    Thread t2 = new Thread(() -> {
        System.out.println("线程2开始运行！");
        for (int i = 0; i < 50; i++) {
            System.out.println("2打印："+i);
        }
    });
    t1.start();
    t2.start();
}
```

观察结果，我们发现，在让位之后，尽可能多的在执行线程2的内容。

##### 四、线程信息与属性

9、`getName()` / `setName(String name)`

- 设置/获取线程名称（调试时非常有用！）。
  ```java
  Thread t = new Thread(task);
  t.setName("Worker-1");
  System.out.println(t.getName()); // "Worker-1"
  ```

10、`getId()`

- 返回线程唯一 ID（long 类型），创建后不变。

11、`getPriority()` / `setPriority(int priority)`

- 获取/设置线程优先级（1\~10，`MIN_PRIORITY` 到 `MAX_PRIORITY`）。
- ⚠️ **不推荐依赖优先级**：不同 OS 实现差异大，不可靠。

12、`getState()`

```java
// Thread.getState方法源码：
public State getState() {
    // get current thread state
    return sun.misc.VM.toThreadState(threadStatus);
}
// sun.misc.VM 源码：
public static State toThreadState(int var0) {
    if ((var0 & 4) != 0) {
        return State.RUNNABLE;
    } else if ((var0 & 1024) != 0) {
        return State.BLOCKED;
    } else if ((var0 & 16) != 0) {
        return State.WAITING;
    } else if ((var0 & 32) != 0) {
        return State.TIMED_WAITING;
    } else if ((var0 & 2) != 0) {
        return State.TERMINATED;
    } else {
        return (var0 & 1) == 0 ? State.NEW : State.RUNNABLE;
    }
}
```

- 返回线程状态（`NEW`, `RUNNABLE`, `BLOCKED`, `WAITING`, `TIMED_WAITING`, `TERMINATED`）。
- 用于监控和调试。

13、`isAlive()`

- 判断线程是否已启动且未终止（即状态不是 `NEW` 或 `TERMINATED`）。

14、`isDaemon()` `setDaemon(boolean on)`

- 判断/设置守护线程

##### 五、线程上下文相关（高级）

15、`getContextClassLoader()` / `setContextClassLoader(ClassLoader cl)`

- 获取/设置线程上下文类加载器（常用于框架如 Spring、JDBC 加载资源）。

16、`holdsLock(Object obj)`（静态方法）

- 判断当前线程是否持有指定对象的 monitor 锁。
  ```java
  synchronized (obj) {
      assert Thread.holdsLock(obj); // true
  }
  ```

> 💡注意：
>
> - `stop()`, `suspend()`, `resume()` 因**不安全**（可能导致死锁、数据不一致）已在 Java 1.2 废弃。
> - 线程的**停止必须协作**（通过中断或 volatile 标志）。
> - 避免直接操作线程，优先使用 `ExecutorService` 等高级并发工具。

### Callable、Future接口与FutureTask类

`Runnable` 和裸 `Thread` 确实实现了“异步执行”（即并发、非阻塞地运行任务），但它们无法以标准、安全、便捷的方式返回计算结果或传递异常，必须通过显式的线程间同步机制（如 `volatile`、`synchronized`、`CountDownLatch` 等）来协调。

JDK提供了 Callable 接口与 Future 接口为我们解决这个问题，这也是所谓的**异步模型**（有返回值，可取消，可查询状态）。

更现代的异步方式：CompletableFuture（Java 8+）、虚拟线程（Virtual Threads，Java 21+ Project Loom）

#### Callable接口

Callable 与 Runnable 类似，同样是只有一个抽象方法的函数式接口。不同的是， Callable 提供的方法是有返回值的，而且支持泛型。

```java
@FunctionalInterface
public interface Callable<V> {
    V call() throws Exception;
}
```

**Callable 一般配合线程池工具 ExecutorService 来使用：**

- 通过 `ExecutorService.submit(Callable<T>)` 提交一个返回值的任务，得到一个 `Future<T>`。后续可以通过 Future 的 get 方法得到结果。
- 简单的使用demo：
  ```java
  // 自定义Callable
  class Task implements Callable<Integer>{
      @Override
      public Integer call() throws Exception {
          // 模拟计算需要一秒
          Thread.sleep(1000);
          return 2;
      }
      public static void main(String args[]) throws Exception {
          // 使用
          ExecutorService executor = Executors.newCachedThreadPool();
          Task task = new Task();
          Future<Integer> result = executor.submit(task); // ← 返回的是 FutureTask<Integer> 实例
          // 注意调用get方法会阻塞当前线程，直到得到结果。
          // 所以实际编码中建议使用可以设置超时时间的重载get方法。
          System.out.println(result.get());
      }
  }
  ```
  输出结果：
  ```bash
  2
  ```

#### Future接口

Future 接口表示一个**异步计算的结果**。它提供了以下能力：

- 检查任务是否完成或取消（`isDone()` `isCancelled()`）
- 取消任务（`cancel(boolean mayInterruptIfRunning)`）
- 获取结果（`get()`）
  - 如果任务还没完成，调用 get() 会阻塞当前线程，直到任务完成并返回结果
  - 如果任务已完成，立即返回结果
  - 如果任务抛出异常，会抛出 ExecutionException（包装了原始异常）
  - 如果任务被取消，会抛出 CancellationException
- 获取结果时处理异常（如 `ExecutionException`）

```java
public abstract interface Future<V> {
    public abstract boolean cancel(boolean mayInterruptIfRunning);
    public abstract boolean isCancelled();
    public abstract boolean isDone();
    public abstract V get() throws InterruptedException, ExecutionException;
    public abstract V get(long timeout, TimeUnit unit)
        throws InterruptedException, ExecutionException, TimeoutException;
}
```

##### 取消任务

`cancel` 方法是试图取消一个线程的执行。

- 注意是**试图取消**，并不一定能取消成功。因为任务可能已完成、已取消、或者一些其它因素不能取消，存在取消失败的可能。
- 参数 `mayInterruptIfRunning` 表示是否采用中断的方式取消线程执行。
  - **`true`**：如果任务**正在执行中**，尝试通过\*\*中断（interrupt）\*\*执行该任务的线程来取消它。
  - **`false`**：即使任务正在运行，也**不中断线程**，而是让其**继续运行直到自然结束**（但逻辑上标记为“已取消”，后续调用 `get()` 会抛出异常）。
  > ⚠️ 注意：这个参数**只对“正在运行”的任务有影响**。
  > 如果任务还没开始（在队列中等待），无论传 `true` 还是 `false`，都会被成功取消（不会执行）。

所以为了**让任务能够取消**，就**使用 Callable/Runnable + Future(一般用 Callable) 来代替 Thread**。因为把 Callable 提交给 ExecutorService 可以得到一个 Future<V> 对象，进而使用 cancel 方法。

> **为什么不用** **`Thread.interrupt()`** **？**
>
> - `Thread.interrupt()` 确实可以用于取消线程，但有局限性，它是协作式取消。
> - 仅靠 `interrupt()` 无法保证任务能被及时、可靠地取消，除非任务本身配合检查中断。
> - 比如若线程在执行**纯计算任务**（比如一个大循环做数学运算），而代码中**没有主动检查中断状态**（`Thread.currentThread().isInterrupted()`），那么 `interrupt()` 就**完全无效**——线程会一直运行下去。

有些后台任务本质上是“fire-and-forget”类型——比如定期清理缓存、发送心跳、轮询等。如果为了**可取消性**而使用 Future 但又**不产生有意义的返回值**，则可以**声明 Future\<?> 形式类型**（表示某种未知类型的 Future，强调不关心结果类型），并**返回 null 作为底层任务的结果**。

```java
// ExecutorService 接口
Future<?> submit(Runnable task);
<T> Future<T> submit(Runnable task, T result);
<T> Future<T> submit(Callable<T> task);
```

- 如果使用 `Runnable` 提交任务，`ExecutorService.submit(Runnable)` 默认返回的是 `Future<?>`，其 `get()` 方法总是返回 `null`（或者使用 submit 时可选的传入参数 result）。**不需要操作已经满足需求**。
- 如果用 `Callable` 来实现，就需要：**声明为** **`Callable<Void>`，在** **`call()`** **方法末尾返回** **`null`**
  ```java
  Callable<Void> task = () -> {
      System.out.println("Lambda 任务开始");
      for (int i = 0; i < 3; i++) {
          if (Thread.currentThread().isInterrupted()) {
              System.out.println("被中断，退出");
              return null; // 必须返回 null
          }
          System.out.println("运行中: " + i);
          Thread.sleep(1000);
      }
      return null; // 末尾返回 null
  };
  ```
- 因为 `Future<Void>` 是 `Future<?>` 的子类型，所以统一使用以下方式来接收 future：
  ```java
  Future<?> future = executor.submit(task);
  ```

#### FutureTask类

Future 接口有**唯一实现类** FutureTask，帮助我们实现了 Future 接口的各种方法。

FutureTask 是实现的 RunnableFuture 接口的，而 RunnableFuture 接口同时继承了 Runnable 接口和 Future 接口。

> 之前的 demo 中 submit 方法会自动创建 `FutureTask` 的实例。

FutureTask 提供了 2 个构造器：

```java
public FutureTask(Callable<V> callable) {
}
public FutureTask(Runnable runnable, V result) {
}
```

## 三、线程组和优先级

### 线程组

Java中用ThreadGroup来表示线程组，我们可以使用线程组对线程进行批量控制。

每个Thread必然存在于一个ThreadGroup中，Thread不能独立于ThreadGroup存在。执行main() 方法线程的名字是main，如果在new Thread时没有显式指定，那么默认将父线程（当前执行new Thread的线程）线程组设置为自己的线程组。

示例代码：

```java
public class Demo {
    public static void main(String[] args) {
        Thread testThread = new Thread(() -> {
            System.out.println("testThread当前线程组名字：" +
            Thread.currentThread().getThreadGroup().getName());
            System.out.println("testThread线程名字：" +
            Thread.currentThread().getName());
        });
    testThread.start();
    System.out.println("执行main所在线程的线程组名字： " + Thread.currentThread().getThreadGroup().getName());
    System.out.println("执行main方法线程名字：" + Thread.currentThread().getName());
    }
}
```

输出结果：

```bash
执行main所在线程的线程组名字： main
执行main方法线程名字：main
testThread当前线程组名字：main
testThread线程名字：Thread-0
```

ThreadGroup管理着它下面的Thread，ThreadGroup是一个标准的向下引用的树状结构，这样设计的原因是**防止"上级"线程被"下级"线程引用而无法有效地被GC回收**。

### 线程的优先级

Java中线程优先级可以指定，范围是1\~10（默认为5），有些操作系统只支持3级划分：低、中、高。

现代 JVM（如 HotSpot）使用的是 **1:1 线程模型**，**每一个 Java 线程都直接映射到一个 OS 原生线程**（如 Linux 的 pthread、Windows 的 kernel thread），这意味着Java 线程的调度 **完全由操作系统调度器决定**，Java 优先级会映射到操作系统的优先级，而结果并不一定尊重原有的优先级。

所以Java只是给操作系统一个优先级的参考值，线程最终在操作系统的优先级和执行顺序还是由操作系统的调度算法决定。

Java 线程优先级常量：

- `Thread.MIN_PRIORITY = 1`
- `Thread.NORM_PRIORITY = 5`
- `Thread.MAX_PRIORITY = 10`

1、可以使用方法 Thread 类的 `setPriority()` 实例方法来设定线程的优先级。

```java
public class Demo {
    public static void main(String[] args) {
        Thread a = new Thread();
        System.out.println("我是默认线程优先级："+a.getPriority());
        Thread b = new Thread();
        b.setPriority(10);
        System.out.println("我是设置过的线程优先级："+b.getPriority());
    }
}
```

输出结果：

```bash
我是默认线程优先级：5
我是设置过的线程优先级：10
```

2、线程组可以设置一个“最大优先级”（max priority），该组内所有线程的优先级都不能超过这个值。

- 当你创建一个 `ThreadGroup` 时，它的初始最大优先级 = **父线程组的最大优先级**。
- 主线程所在的根线程组（`system`）默认最大优先级是 `10`（即 `Thread.MAX_PRIORITY`）。

```java
ThreadGroup.setMaxPriority(int pri)
```

> 注意：**永远不要依赖线程优先级来保证程序正确性或性能**，Java中的线程优先级并不可靠。
>
> 通过代码来验证一下：
>
> ```java
> import java.util.stream.IntStream;
>
> public class Demo {
>  public static class T1 implements Runnable {
>      @Override
>      public void run() {
>          // 打印当前执行线程的名称和优先级
>          System.out.println(String.format(
>              "当前执行的线程是：%s，优先级：%d",
>              Thread.currentThread().getName(),
>              Thread.currentThread().getPriority()
>          ));
>      }
>  }
>
>  public static void main(String[] args) {
>      // 创建并启动 9 个线程，优先级从 1 到 9
>      IntStream.range(1, 10).forEach(i -> {
>          Thread thread = new Thread(new T1()); // 传入 Runnable 任务
>          thread.setPriority(i);                // 设置线程优先级
>          thread.start();                       // 启动线程
>      });
>  }
> }
> ```
>
> 某次输出：
>
> ```bash
> 当前执行的线程是：Thread-17，优先级：9
> 当前执行的线程是：Thread-1，优先级：1
> 当前执行的线程是：Thread-13，优先级：7
> 当前执行的线程是：Thread-11，优先级：6
> 当前执行的线程是：Thread-15，优先级：8
> 当前执行的线程是：Thread-7，优先级：4
> 当前执行的线程是：Thread-9，优先级：5
> 当前执行的线程是：Thread-3，优先级：2
> 当前执行的线程是：Thread-5，优先级：3
> ```
>
> **创建/启动顺序 ≠ 执行顺序**
>
> - `start()` 被调用的顺序确实是 1→2→…→9，但并不意味着线程会立刻执行 `run()` 方法，实际上是多个线程在几乎同一时刻进入就绪（Runnable）状态，等待 CPU 调度器分配时间片来真正运行。

## 四、线程的状态和转换

### 操作系统OS和Java中的线程状态转换

| 维度      | 操作系统（OS）线程状态                         | Java 线程状态（`java.lang.Thread.State`） |
| :------ | :----------------------------------- | :---------------------------------- |
| **定义者** | 操作系统内核（如 Linux、Windows）              | Java 虚拟机（JVM）                       |
| **目的**  | 决定 CPU 调度、资源分配、睡眠/唤醒等                | 向 Java 程序员提供**逻辑上的线程生命周期视图**        |
| **可见性** | 通过 `top -H`、`ps -T`、`htop` 等 OS 工具查看 | 通过 `thread.getState()` 在 Java 代码中获取 |
| **粒度**  | 底层、物理（真实 CPU 执行状态）                   | 高层、逻辑（抽象的程序行为）                      |

**操作系统线程状态（以 Linux 为例）**

在支持多线程的操作系统中，CPU 调度的基本单位是线程，每个线程有独立的调度状态（如 Linux 的 R/S/D/T/Z）。

| OS 状态                    | 含义                        | 对应场景                                                |
| :----------------------- | :------------------------ | :-------------------------------------------------- |
| `R` (Running / Runnable) | 正在 CPU 上运行，或在可运行队列中等待 CPU | Java 的 `RUNNABLE` / `R`（自旋阶段）                       |
| `S` (Sleeping)           | 可中断睡眠（等待事件，如 I/O、锁、sleep） | Java 的 `WAITING` / `TIMED_WAITING` / `BLOCKED`（挂起后） |
| `D` (Disk Sleep)         | 不可中断睡眠（通常在等磁盘 I/O）        | 很少由 Java 直接引起                                       |
| `T` (Stopped)            | 被信号暂停（如 `SIGSTOP`）        | 调试时可能见到                                             |
| `Z` (Zombie)             | 已退出但父进程未回收                | Java 线程不会出现（JVM 管理线程生命周期）                           |

> ⚠️ 注意：Windows、macOS 的状态命名不同，但概念类似。

**关键映射关系（以 HotSpot JVM on Linux 为例）**

| Java 状态         | 可能对应的 OS 状态                  | 说明                                     |
| :-------------- | :--------------------------- | :------------------------------------- |
| `NEW`           | 无（OS 线程尚未创建）                 | 调用 `start()` 后才创建 OS 线程                |
| `RUNNABLE`      | `R`                          | 正在运行或可运行                               |
| `BLOCKED`       | **`R`（自旋阶段）** 或 **`S`（挂起后）** | ⭐ 最易混淆！轻量级锁时自旋（OS 是 R），重量级锁时挂起（OS 是 S） |
| `WAITING`       | `S`                          | 如 `wait()` 会调用 OS 的 `futex_wait`，进入睡眠  |
| `TIMED_WAITING` | `S`                          | 如 `sleep()` 会让 OS 线程睡眠指定时间             |
| `TERMINATED`    | 线程已销毁（无状态）                   | OS 线程被回收                               |

### Java线程的六种状态和转换

![image-20260106002627819](/blogs/juc-img/image-20260106002627819.png)

```java
// Thread.State 源码
public enum State {
    NEW,
    RUNNABLE,
    BLOCKED,
    WAITING,
    TIMED_WAITING,
    TERMINATED;
}
```

1、处于NEW状态的线程此时尚未启动。这里的尚未启动指的是还没调用Thread实例的start()方法。

```java
private void testStateNew() {
    Thread thread = new Thread(() -> {});
    System.out.println(thread.getState()); // 输出 NEW
}
```

> 1、反复调用同一个线程的start()方法是否可行？
>
> ```java
> // start()的源码
> public synchronized void start() {
>  if (threadStatus != 0)
>      throw new IllegalThreadStateException();
>
>  group.add(this);
>
>  boolean started = false;
>  try {
>      start0();
>      started = true;
>  } finally {
>      try {
>          if (!started) {
>              group.threadStartFailed(this);
>          }
>      } catch (Throwable ignore) {
>      }
>  }
> }
> ```
>
> 2、假如一个线程执行完毕（此时处于TERMINATED状态），再次调用这个线程的start()方法是否可行？
>
> 两个问题的答案都是不行。在start()内部有一个threadStatus的变量。在调用一次start()之后，它的值会改变不再为0；TERMINATED状态下它的值为2，此时再次调用start()方法会抛出IllegalThreadStateException异常。

2、RUNNABLE表示当前线程正在运行中。在Java虚拟机中运行，也有可能在等待CPU分配资源。

当CPU给予的运行时间结束时，会从运行状态回到就绪（可运行）状态，等待下一次获得CPU资源。

Thread源码里RUNNABLE状态的定义：

```
/**
 * Thread state for a runnable thread. A thread in the runnable
 * state is executing in the Java virtual machine but it may
 * be waiting for other resources from the operating system
 * such as processor.
 */
```

> Java线程的RUNNABLE状态其实包括了传统操作系统进程的ready和running两个状态。

3、处于BLOCKED阻塞状态的线程正等待锁的释放以进入同步区。

根据 Java 官方文档：

> A thread in the **blocked** state is waiting for a monitor lock to enter a synchronized block/method or reenter a synchronized block/method after calling `Object.wait()`.

也就是说，线程处于 `BLOCKED` 是因为：

- Runnable 状态下的线程尝试进入 `synchronized` 块/方法
- 但目标对象的 **monitor 锁已被其他线程持有**
- 因此当前线程被 JVM 挂起，**等待锁释放**

> 注意：`BLOCKED` **不包括** `wait()`、`sleep()`、I/O 等情况（那些是 `WAITING` 或 `TIMED_WAITING`）

4、处于WAITING等待状态的线程变成RUNNABLE状态需要其他线程唤醒。

调用如下3个方法会使线程进入等待状态：

- Object.wait()：使当前线程处于等待状态直到另一个线程唤醒它；
  - 调用wait()方法前线程必须持有对象的锁
  - 线程调用wait()方法时，会释放当前的锁，进入该对象的等待队列（wait set），并暂停执行
  - 直到以下情况才会被唤醒并尝试重新获取锁
    - 有其他线程调用notify()/notifyAll()方法唤醒等待锁的线程
    - 如果使用的是 `wait(long timeout)` 或 `wait(long timeout, int nanos)`，则超时时间到达
- Thread.join()：等待线程执行完毕；
  ```java
  public void blockedTest() {
      ······
      a.start();
      a.join();
      b.start();
      System.out.println(a.getName() + ":" + a.getState()); // 输出 TERMINATED
      System.out.println(b.getName() + ":" + b.getState());
  }
  ```
  - 要是没有调用 join 方法，main 线程不管 a 线程是否执行完毕都会继续往下走。
  - a 线程启动之后马上调用了 join 方法，这里 main 线程就会等到 a 线程执行完毕，所以这里 a 线程打印的状态固定是**TERMINATED**。
  - 至于 b 线程的状态，有可能打印 RUNNABLE（尚未进入同步方法），也有可能打印 TIMED\_WAITING（进入了同步方法）。
  > 底层调用的是Object实例的wait方法
  >
  > ```java
  > public final synchronized void join(long millis) throws InterruptedException {
  >  long base = System.currentTimeMillis();
  >  long now = 0;
  >
  >  if (millis < 0) {
  >      throw new IllegalArgumentException("timeout value is negative");
  >  }
  >
  >  if (millis == 0) {
  >      while (isAlive()) {
  >          wait(0); // 注意：这里调用了 wait()
  >      }
  >  } else {
  >      // 带超时的逻辑（略）
  >  }
  > }
  > ```
  >
  > - `join()` 方法是 **`synchronized`** 的 → 锁的是 **`this`**（即被 join 的那个 `Thread` 对象本身）。
  > - 在循环中调用 `wait(0)` → 这个 `wait()` 是 **`this.wait()`**，也就是在 **`Thread`** **实例对象上等待**。

5、超时等待状态TIMED\_WAITING。线程等待一个具体的时间，时间到后会被自动唤醒。

调用如下方法会使线程进入超时等待状态：

- Thread.sleep(long millis)：使当前线程睡眠指定时间；
  - 注意只是暂时使线程停止执行，并不会释放锁。时间到后，线程会重新进入RUNNABLE状态。
- Object.wait(long timeout)：线程休眠指定时间，等待期间可以通过notify()/notifyAll()唤醒；
  - 与无参方法不同的地方是，有参方法就算其他线程不来唤醒它，自动唤醒后也拥有去争夺锁的资格。
- Thread.join(long millis)：等待当前线程最多执行millis毫秒，如果millis为0，则会一直执行；

6、TERMINATED 终止状态。此时线程已执行完毕。

当线程的 `run()` 方法执行完毕，或抛出未被捕获的异常/错误时，线程将进入 TERMINATED 状态。

目前在Java里还没有安全直接的方法来停止线程，但是Java提供了**线程中断机制**来处理需要中断线程的情况。

线程中断机制是一种协作机制。需要注意，通过中断操作并不能直接终止一个线程，而是通知需要被中断的线程自行处理。

## 五、多线程的问题

### 线程安全问题（数据正确性）和线程同步

#### 1 原子性（Atomicity）

> - 原子性：即一个操作或者多个操作，要么全部执行并且执行的过程不会被任何因素打断，要么就都不执行。
> - 原子操作：即不会被线程调度机制打断的操作，没有上下文切换。

在并发编程中很多操作都不是原子操作：

```java
int i = 0; // 操作1
i++;   // 操作2
int j = i; // 操作3
i = i + 1; // 操作4
```

- 操作2、4不是原子操作，实际上是一个 "read-modify-write" 操作，它包括了读取 i 的值，增加 i，然后写回 i。

在单线程环境下上述四个操作都不会出现问题，但是在多线程环境下，如果不加锁的话，可能会得到意料之外的值。

```java
public class YuanziDeo {
    private static int i = 0;

    public static void main(String[] args) throws InterruptedException {
        int numThreads = 2;
        int numIncrementsPerThread = 100000;

        Thread[] threads = new Thread[numThreads];

        for (int j = 0; j < numThreads; j++) {
            threads[j] = new Thread(() -> {
                for (int k = 0; k < numIncrementsPerThread; k++) {
                    i++;
                }
            });
            threads[j].start();
        }

        for (Thread thread : threads) {
            thread.join();
        }

        System.out.println("Final value of i = " + i);
        System.out.println("Expected value = " + (numThreads * numIncrementsPerThread));
    }
}
```

输出如下：

```bash
Final value of i = 102249
Expected value = 200000
```

**解决工具**：

- **锁机制**：`synchronized`、`ReentrantLock`（互斥执行）
- **原子类**：`AtomicInteger`（CAS）、`LongAdder`（分段累加，高并发优化）
- **底层原理**：CPU 的 CAS 指令 + `volatile` 保证读取最新值

> 注意：`volatile` 不能保证原子性！

#### 2 可见性（Visibility）与 volatile 关键字

```java
class Test {
  int i = 50;
  int j = 0;

  public void update() {
    // 线程1执行
    i = 100;
  }

  public int get() {
    // 线程2执行
    j = i;
    return j;
  }
}
```

- 线程 1 执行 update 方法将 i 赋值为 100，一般情况下线程 1 会在自己的工作内存中完成赋值操作，但不会及时将新值刷新到主内存中。
- 这个时候线程 2 执行 get 方法，首先会从主内存中读取 i 的值，然后加载到自己的工作内存中，此时读到 i 的值仍然是 50，再将 50 赋值给 j，最后返回 j 的值就是 50 了，这就是可见性问题，线程 A 修改了变量，线程 B 仍看到旧值（因 CPU 缓存或编译器优化）。

<img src="/blogs/juc-img/thread-bring-some-problem-d91ca0c2-4f39-4e98-90e2-8acb793eb983.png" alt="thread-bring-some-problem-d91ca0c2-4f39-4e98-90e2-8acb793eb983" style="zoom: 33%;" />

> 可见性：当多个线程访问同一个变量时，一个线程修改了这个变量的值，其他线程能够立即看得到修改的值。

**解决工具**：

- `volatile`：写操作后立即刷回主存，读操作前从主存加载
  ```java
  public class VolatileExample {
      int a = 0;
      volatile boolean flag = false;
      public void writer() {
          a = 1; // step 1
          flag = true; // step 2
      }
      public void reader() {
          if (flag) { // step 3
              System.out.println(a); // step 4
          }
      }
  }
  ```
- `synchronized` / `Lock`：退出同步块时刷新工作内存

#### 3 有序性（Ordering）

**问题**：编译器/CPU 重排序导致 `a=1; flag=true;` 被重排为 `flag=true; a=1;`，破坏逻辑。

JMM 定义了一套**happens-before（先行发生）规则**，用来保证**跨线程的操作可见性和有序性**。

| 规则               | 说明                                            |
| ---------------- | --------------------------------------------- |
| 1. 程序顺序规则        | 在同一个线程内，按照代码顺序，前面的操作 happens-before 后面的操作     |
| 2. 监视器锁规则        | 对一个锁的解锁 happens-before 后续对这个锁的加锁              |
| 3. volatile 变量规则 | 对一个 volatile 变量的写操作 happens-before 后续对该变量的读操作 |
| 4. 线程 start 规则   | Thread.start() happens-before 该线程的任何操作        |
| 5. 线程 join 规则    | 线程中的所有操作 happens-before 其他线程对该线程的 join() 返回   |
| 6. 中断规则          | interrupt() happens-before 被中断线程检测到中断         |
| 7. finalizer 规则  | 对象构造完成 happens-before finalize() 开始           |
| 8. 传递性           | 如果 A hb B，B hb C，则 A hb C                     |

`volatile` 不仅提供**可见性**（写后立即刷主存，读后立即读主存），更重要的是它通过**插入内存屏障（Memory Barrier）** 来**禁止特定类型的重排序**。

由于编译器和处理器都能执行指令重排的优化，如果在指令间插入一条Memory Barrier则会告诉编译器和CPU，不管什么指令都不能和这条Memory Barrier指令重排序。

- 在每个volatile写操作前插入一个StoreStore屏障；
- 在每个volatile写操作后插入一个StoreLoad屏障；
- 在每个volatile读操作后插入一个LoadLoad屏障；
- 在每个volatile读操作后再插入一个LoadStore屏障。

![image-20260108033326901](/blogs/juc-img/image-20260108033326901.png)

| 屏障类型       | 指令示例                     | 说明                                    |
| ---------- | ------------------------ | ------------------------------------- |
| LoadLoad   | Load1;LoadLoad;Load2     | 保证Load1的读取操作在Load2及后续读取操作之前执行         |
| StoreStore | Store1;StoreStore;Store2 | 在Store2及其后的写操作执行前，保证Store1的写操作已刷新到主内存 |
| LoadStore  | Load1;LoadStore;Store2   | 在Store2及其后的写操作执行前，保证Load1的读操作已读取结束    |
| StoreLoad  | Store1;StoreLoad;Load2   | 保证load1的写操作已刷新到主内存之后，load2及其后的读操作才能执行 |

#### 变量的线程安全分析

1、成员变量和静态变量是否线程安全？

- 如果它们没有共享，则线程安全
- 如果它们被共享了，根据它们的状态是否能改变，分为两种情况
  - 如果只有读操作，则线程安全
  - 如果有读写操作，则这段代码是临界区，需要考虑线程安全

2、局部变量是否线程安全？

- 通常情况下，方法内的局部变量是线程安全的，因为它们只能在方法内部访问，每个线程都有自己的栈帧，而局部变量就存放在栈帧内。
- 但局部变量引用的对象未必是线程安全的
  - 如果该对象没有逃离方法的作用域，那么它是线程安全的
  - 如果该对象逃离了方法的作用范围，则需要考虑线程安全

示例1：

```java
public static void test1() {
    int i = 10;
    i++;
}
```

每个线程调用test1()方法时，局部变量i会在每个线程的栈帧内存中被创建多份，因此不存在共享，使用 `javap -v` 命令查看test1()的字节码：

```bash
public static void test1();
  descriptor: ()V
  flags: ACC_PUBLIC, ACC_STATIC
  Code:
    stack=1, locals=1, args_size=0
       0: bipush        10                    // 将整数10推送到操作数栈顶。
       2: istore_0                            // 将操作数栈顶的整数值存储到局部变量表的索引为0的位置（即将10存储到局部变量i） 
       3: iinc          0, 1                  // 将局部变量表中索引为0的位置的整数值增加1。
      Start  Length  Slot  Name   Signature
          3       4     0     i   I
```

示例2：

- 当多个线程执行的指令交错的时候，可能会出现list中没有元素，但是却执行了remove操作，此时就会报错
  ```java
  public class Test01 {
      static final int THREAD_NUM = 2;
      static final int LOOP_NUM = 200;
  
      public static void main(String[] args) {
          ThreadUnsafe test = new ThreadUnsafe();
          for (int i = 0; i < THREAD_NUM; i++) {
              new Thread(() -> {
                  test.method01(LOOP_NUM);
              }, "Thread" + i).start();
          }
      }
  }
  
  class ThreadUnsafe {
      ArrayList<String> list = new ArrayList<>();
  
      public void method01(int loopNum) {
          for (int i = 0; i < loopNum; i++) {
              // 临界区，会发生竞态条件
              method02();
              method03();
          }
      }
  
      private void method02() {
          list.add("1");
      }
  
      public void method03() {
          list.remove(0);
      }
  }
  ```
- 报错
  ```bash
  Exception in thread "Thread1" java.lang.IndexOutOfBoundsException: Index: 0, Size: 0
  at java.util.ArrayList.rangeCheck(ArrayList.java:657)
  at java.util.ArrayList.remove(ArrayList.java:496)
  at cn.itcast.n6.ThreadUnsafe.method3(TestThreadSafe.java:35)
  at cn.itcast.n6.ThreadUnsafe.method1(TestThreadSafe.java:26)
  at cn.itcast.n6.TestThreadSafe.lambda$main$0(TestThreadSafe.java:14)
  at java.lang.Thread.run(Thread.java:748)
  ```
- 分析：无论哪个线程中的method02或method03中，引用的都是同一个对象中的list成员变量
- 下面我们将list修改为局部变量
  ```java
  class ThreadSafe {
  
      public void method01(int loopNum) {
          ArrayList<String> list = new ArrayList<>();
          for (int i = 0; i < loopNum; i++) {
              // 临界区，会发生竞态条件
              method02(list);
              method03(list);
          }
      }
  
      private void method02(ArrayList<String> list) {
          list.add("1");
      }
  
      private void method03(ArrayList<String> list) {
          list.remove(0);
      }
  }
  ```
- 此时无论运行多少次，也不会出现上述的问题了。因为此时list是局部变量，每个线程调用时会创建其不同的实例，没有共享
- **如果将方法设为** **`public`**，会**极大扩大攻击面（attack surface）**，
  使得外部代码可以绕过原有逻辑，直接对共享状态进行非原子、无保护的操作，必然导致线程安全问题（崩溃、数据错误、死锁等）。

  因此：**不要将内部辅助方法暴露为 public**，尤其是当它们操作共享状态且属于某个复合操作的一部分时。**封装是线程安全的第一道防线**。

#### 常见的线程安全类

1. String
2. Integer
3. StringBuffer
4. Random
5. Vector
6. Hashtable
7. java.util.concurrent包下的类

这里说它们是线程安全的是指，当多个线程调用它们同一个实例的某个方法时，是线程安全的，可以理解为：

```java
Hashtable table = new Hashtable();
new Thread(() -> table.put("key", "value"), "t1").start();
new Thread(() -> table.put("key", "value"), "t2").start();
```

> 注意：虽然它们的每个方法都是原子的，但多个方法的组合不是原子的，比如
>
> ```java
> Hashtable table = new Hashtable();
> // 两个线程同时执行
> if (table.get("key") == null) {
>  table.put("key", value);
> }
> ```

**不可变类的线程安全性**

- 在Java中，String类和Integer类被设计为不可变类（Immutable Class），这意味着一旦创建了对象，其状态就不能被修改。这种不可变性使得String和Integer对象在多线程环境中是线程安全的，因为它们的状态不会发生变化，所以不会导致线程安全问题。
  1. String类的线程安全性
     - 字符串是不可变的，一旦创建就不能修改。任何对字符串的修改都会创建一个新的字符串对象，而不会修改原始字符串对象。
     - 因为字符串不可变，所以多个线程可以同时访问同一个字符串对象，而不需要担心竞争条件或数据不一致的问题。
  2. Integer类的线程安全性
     - Integer类是一个包装类，用于封装int类型的值。它也是不可变的，一旦创建就不能修改
     - 对于常见的整数值（-128 \~ 127），Java使用IntegerCache来重用Integer对象。这意味着多个线程同时访问这些整数值时，会得到相同的Integer对象
     - 对于超出缓存范围的整数值，每个线程都会获得一个独立的Integer对象，因此不会存在竞态条件。

#### 线程同步

**在多线程环境中，为了保证线程安全，我们需要通过线程同步来解决。**

> \*\*同步：\*\*协调多个进程或线程对共享资源的访问，以确保程序的正确性、一致性和可预测性。
>
> **为什么需要同步？**—— 举个例子
>
> 场景：银行账户转账
>
> ```java
> int balance = 1000;
>
> // 线程A：取款500
> balance = balance - 500;
>
> // 线程B：取款600
> balance = balance - 600;
> ```
>
> 理想结果：余额不能为负，第二次取款应失败。
>
> 但实际可能：
>
> 1. A 读取 balance = 1000
> 2. B 也读取 balance = 1000（此时A还没写回）
> 3. A 计算 1000 - 500 = 500，写回
> 4. B 计算 1000 - 600 = 400，写回 ❌
>
> 最终余额是 400，而不是正确的 500 或 -100（取决于业务逻辑）。

> \[!CAUTION]
>
> **临界区（Critical Section）是多线程中一个非常重要的概念，指的是在代码中访问共享资源的那部分，且同一时刻只能有一个线程能访问的代码。多个线程同时访问临界区的资源如果没有任何同步（加锁）操作，会导致资源的状态不可预测和不一致，从而产生所谓的**“竞态条件”(Race Condition)。在许多并发控制策略中，例如互斥锁 synchronized，目标就是确保任何时候只有一个线程进入临界区。

**解决方法：用同步机制保证“读-改-写”操作不可分割（原子性）**。

**同步机制：**

1、**锁（Lock）**

- **synchronized（Java 关键字）**
  ```java
  synchronized (lockObject) {
      // 临界区代码
  }
  ```
- **ReentrantLock（JUC 提供）**
  ```java
  lock.lock();
  try {
      // 临界区
  } finally {
      lock.unlock();
  }
  ```

2、**信号量（Semaphore）**

- 控制同时访问某资源的线程数量（如数据库连接池最多10个连接）。

3、**条件变量（Condition）**

- 线程可以“等待某个条件成立”再继续（如生产者-消费者模型）。

4、**屏障（Barrier）**

| 类               | 所在包                    | 说明                 |
| --------------- | ---------------------- | ------------------ |
| `CyclicBarrier` | `java.util.concurrent` | 可重用的屏障，适用于多轮同步     |
| `Phaser`        | `java.util.concurrent` | 更灵活、可动态注册/注销参与者的屏障 |

> ⚠️ 不要和 **CPU/编译器层面的“内存屏障（Memory Barrier）”** 混淆！
> 那个是 JMM 底层机制（如 `volatile` 插入的 StoreLoad 屏障），**程序员不直接操作**。
> 而这里的 **Barrier 是应用层同步工具，程序员主动使用**。

- 多个线程必须都到达某个点后才能继续（如并行计算的阶段同步）。

5、**原子类（AtomicXXX）**

- 利用 CAS（Compare-And-Swap）实现无锁同步，如 `AtomicInteger`。

### 活跃性问题（程序能否 progress）

> 活跃性是指某件正确的事情最终会发生，但当某个操作无法继续下去的时候，就会发生活跃性问题。

| 问题       | 成因                                       | 解决方案                                     |
| -------- | ---------------------------------------- | ---------------------------------------- |
| **死锁**   | 多线程循环等待资源                                | 避免嵌套锁、按固定顺序加锁、使用 `tryLock(timeout)`      |
| **活锁**   | 线程不断响应变化但无进展                             | 引入随机退避，打破对称性                             |
| **饥饿**   | 低优先级线程长期得不到资源（`ReentrantLock()` 默认是非公平锁） | 公平锁（`ReentrantLock(true)`）、合理调度          |
| **资源泄漏** | 线程池未关闭、Future 未处理                        | try-with-resources、`executor.shutdown()` |

#### 死锁

其实死锁的概念在`操作系统`中也有提及，它是指两个线程相互持有对方需要的锁，但是又迟迟不释放，导致程序卡住：

![image-20221004205058223](/blogs/juc-img/Ja6TPO23wCI8pvn.png)

我们发现，线程A和线程B都需要对方的锁，但是又被对方牢牢把握，由于线程被无限期地阻塞，因此程序不可能正常终止。我们来看看以下这段代码会得到什么结果：

```java
public static void main(String[] args) throws InterruptedException {
    Object o1 = new Object();
    Object o2 = new Object();
    Thread t1 = new Thread(() -> {
        synchronized (o1){
            try {
                Thread.sleep(1000);
                synchronized (o2){
                    System.out.println("线程1");
                }
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        }
    });
    Thread t2 = new Thread(() -> {
        synchronized (o2){
            try {
                Thread.sleep(1000);
                synchronized (o1){
                    System.out.println("线程2");
                }
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        }
    });
    t1.start();
    t2.start();
}
```

所以在编写程序时一定要避免这种死锁的情况。

那么如何去检测死锁呢？可以利用 `jstack` 命令来检测死锁，首先利用 `jps` 找到java进程：

```shell
nagocoler@NagodeMacBook-Pro ~ % jps
51592 Launcher
51690 Jps
14955 
51693 Main
nagocoler@NagodeMacBook-Pro ~ % jstack 51693
...
Java stack information for the threads listed above:
===================================================
"Thread-1":
	at com.test.Main.lambda$main$1(Main.java:46)
	- waiting to lock <0x000000076ad27fc0> (a java.lang.Object)
	- locked <0x000000076ad27fd0> (a java.lang.Object)
	at com.test.Main$$Lambda$2/1867750575.run(Unknown Source)
	at java.lang.Thread.run(Thread.java:748)
"Thread-0":
	at com.test.Main.lambda$main$0(Main.java:34)
	- waiting to lock <0x000000076ad27fd0> (a java.lang.Object)
	- locked <0x000000076ad27fc0> (a java.lang.Object)
	at com.test.Main$$Lambda$1/396873410.run(Unknown Source)
	at java.lang.Thread.run(Thread.java:748)

Found 1 deadlock.
```

`jstack` 自动帮助我们找到了一个死锁，并打印出了相关线程的栈追踪信息，同样的，使用 `jconsole` 也可以进行监测。

**问题背景：转账中的死锁风险**

假设有两个账户：

- 账户 A（ID = 1）
- 账户 B（ID = 2）

两个线程同时执行转账：

- **线程1**：从 A → B（需要先锁 A，再锁 B）
- **线程2**：从 B → A（需要先锁 B，再锁 A）

**死锁发生过程：**

1. 线程1 成功锁住 A
2. 线程2 成功锁住 B
3. 线程1 尝试锁 B → 被阻塞（B 被线程2 占着）
4. 线程2 尝试锁 A → 被阻塞（A 被线程1 占着）
5. 双方互相等待 → **死锁！**

> 这就是经典的“**循环等待**”死锁条件。

**解决方案：按账户 ID 固定顺序加锁**

**核心思想：**

> **无论谁转账，都必须按照“账户 ID 从小到大”的顺序加锁。**

这样就**消除了加锁顺序的不确定性**，从根本上避免循环等待。

**具体实现（Java 示例）**

```
class Account {
    final int id;
    volatile int balance;

    public Account(int id, int balance) {
        this.id = id;
        this.balance = balance;
    }
}

public class TransferService {

    public void transfer(Account from, Account to, int amount) {
        // 关键：按 ID 顺序确定加锁顺序
        Account first = from.id < to.id ? from : to;
        Account second = from.id < to.id ? to : from;

        synchronized (first) {
            synchronized (second) {
                // 执行转账
                if (from.balance >= amount) {
                    from.balance -= amount;
                    to.balance += amount;
                } else {
                    throw new IllegalArgumentException("Insufficient funds");
                }
            }
        }
    }
}
```

**场景演示：A(1) ↔ B(2) 双向转账**

**情况1：A → B**

- `from = A(id=1)`, `to = B(id=2)`
- `first = A`, `second = B`
- 加锁顺序：**A → B**

**情况2：B → A**

- `from = B(id=2)`, `to = A(id=1)`
- `first = A`, `second = B`（因为 1 < 2）
- 加锁顺序：**还是 A → B！**

✅ **无论方向如何，加锁顺序永远一致！**

#### 哲学家就餐问题

有五位哲学家，分别是苏格拉底、柏拉图、亚里士多德、赫拉克利特、阿基米德，围坐在圆桌旁

- 他们只做两件事，思考和吃饭，思考一会儿吃口饭，吃完饭继续思考
- 吃饭时要用两根筷子吃，桌上共有5根筷子，每位哲学家左右手边各有一根筷子。
- 如果筷子被身边人拿着，自己就得等待

模拟一下这个场景

1、筷子类

```java
public class Chopstick {
    String name;

    public Chopstick(String name) {
        this.name = name;
    }

    @Override
    public String toString() {
        return "Chopstick{" +
                "name='" + name + '\'' +
                '}';
    }
}
```

2、哲学家类

```java
@Slf4j(topic = "c.Philosopher")
public class Philosopher extends Thread {
    Chopstick left;
    Chopstick right;

    public Philosopher(String name, Chopstick left, Chopstick right) {
        super(name);
        this.left = left;
        this.right = right;
    }

    private void eat() {
        log.debug("我踏马吃吃吃");
        try {
            Thread.sleep(1000);
        } catch (InterruptedException e) {
            throw new RuntimeException(e);
        }
    }

    @Override
    public void run() {
        while (true) {
            // 拿左手筷子
            synchronized (left) {
                // 拿右手筷子
                synchronized (right) {
                    eat();
                }
                // 放下右手筷子
            }
            // 放下左手筷子
        }
    }
}
```

3、就餐

```java
public class Test04 {
    public static void main(String[] args) {
        Chopstick c1 = new Chopstick("1");
        Chopstick c2 = new Chopstick("2");
        Chopstick c3 = new Chopstick("3");
        Chopstick c4 = new Chopstick("4");
        Chopstick c5 = new Chopstick("5");

        new Philosopher("苏格拉底", c1, c2).start();
        new Philosopher("柏拉图", c2, c3).start();
        new Philosopher("亚里士多德", c3, c4).start();
        new Philosopher("赫拉克利特", c4, c5).start();
        new Philosopher("阿基米德", c5, c1).start();
    }
}
```

- 执行不一会儿，就执行不下去了
  ```
  21:03:57.796 c.Philosopher [苏格拉底] - 我踏马吃吃吃
  21:03:57.796 c.Philosopher [亚里士多德] - 我踏马吃吃吃
  21:03:58.804 c.Philosopher [柏拉图] - 我踏马吃吃吃
  21:03:59.804 c.Philosopher [柏拉图] - 我踏马吃吃吃
  21:04:00.806 c.Philosopher [柏拉图] - 我踏马吃吃吃
  21:04:01.816 c.Philosopher [苏格拉底] - 我踏马吃吃吃
  ```
- 使用jconsole来检测一下是否发生了死锁
  ![pCzX44H](/blogs/juc-img/pCzX44H.png)
- 确实是发生了死锁
  ```
  名称: 阿基米德
  状态: com.cyborg2077.demo03.Chopstick@1eadee3上的BLOCKED, 拥有者: 苏格拉底
  总阻止数: 1, 总等待数: 0
  
  堆栈跟踪: 
  com.cyborg2077.demo03.Philosopher.run(Philosopher.java:32)
     - 已锁定 com.cyborg2077.demo03.Chopstick@45bda0d0
  -------------------------------------------------------------------------
  名称: 苏格拉底
  状态: com.cyborg2077.demo03.Chopstick@754b4f67上的BLOCKED, 拥有者: 柏拉图
  总阻止数: 8, 总等待数: 2
  
  堆栈跟踪: 
  com.cyborg2077.demo03.Philosopher.run(Philosopher.java:32)
     - 已锁定 com.cyborg2077.demo03.Chopstick@1eadee3
  -------------------------------------------------------------------------
  名称: 柏拉图
  状态: com.cyborg2077.demo03.Chopstick@18f3778b上的BLOCKED, 拥有者: 亚里士多德
  总阻止数: 3, 总等待数: 3
  
  堆栈跟踪: 
  com.cyborg2077.demo03.Philosopher.run(Philosopher.java:32)
     - 已锁定 com.cyborg2077.demo03.Chopstick@754b4f67
  -------------------------------------------------------------------------
  名称: 亚里士多德
  状态: com.cyborg2077.demo03.Chopstick@68d84ce6上的BLOCKED, 拥有者: 赫拉克利特
  总阻止数: 7, 总等待数: 2
  
  堆栈跟踪: 
  com.cyborg2077.demo03.Philosopher.run(Philosopher.java:32)
     - 已锁定 com.cyborg2077.demo03.Chopstick@18f3778b
  -------------------------------------------------------------------------
  名称: 赫拉克利特
  状态: com.cyborg2077.demo03.Chopstick@45bda0d0上的BLOCKED, 拥有者: 阿基米德
  总阻止数: 2, 总等待数: 0
  
  堆栈跟踪: 
  com.cyborg2077.demo03.Philosopher.run(Philosopher.java:32)
     - 已锁定 com.cyborg2077.demo03.Chopstick@68d84ce6
  ```
- 现在一人手里一根筷子，都在等待对方释放资源，线程执行不下去了
- 解决办法继续看后面的可重入锁

#### 活锁

\*\*举例：\*\*A 和 B 是两个朋友，每人钱包里都有 **10 块钱**。

- A 想还 B **10 块**（A → B）
- B 也想还 A **10 块**（B → A）

他们约定：

> “转账前先看对方有没有欠我钱，如果有，我就转；但如果我发现我自己的钱不够，或者对方正在操作，我就放弃这次，等一会儿再试。”

现在，两人**同时开始操作**：

| 时间  | A 的动作                             | B 的动作                   | 结果             |
| --- | --------------------------------- | ----------------------- | -------------- |
| t=0 | 看自己有 10 元 → 够转                    | 看自己有 10 元 → 够转          | 都决定要转          |
| t=1 | 扣自己 10 元（A=0）                     | 扣自己 10 元（B=0）           | 钱都扣了           |
| t=2 | 准备加给 B → 但发现 B 的账户正在被修改（因为 B 也在转） | 准备加给 A → 但发现 A 的账户正在被修改 | 双方都警觉：“状态不一致！” |
| t=3 | A 说：“算了，这次作废，我把 10 块退回来”（A=10）    | B 说：“我也作废，退回来”（B=10）    | 回到初始状态         |
| t=4 | 两人休息 10 毫秒，又同时重试……                | <br />                  | ⏳ 又一轮同样的操作     |

```java
class Account {
    volatile int balance;

    // 尝试从 this 转账到 target
    boolean tryTransfer(Account target, int amount) {
        // 第一步：检查余额（读）
        if (this.balance < amount) {
            return false; // 钱不够，失败
        }

        // 第二步：模拟“准备转账”——这里没有原子性！
        this.balance -= amount;          // 先扣自己的钱
        // 此刻如果被打断，target 还没收到钱！

        // 第三步：检查 target 是否“可用”（比如是否被锁、是否状态异常）
        // 假设这里有个并发检查：如果 target.balance 被另一个线程改了，就认为不安全
        if (/* 检测到 target 状态异常 */) {
            // 回滚！把钱加回来
            this.balance += amount;
            return false;
        }

        // 第四步：加钱给对方
        target.balance += amount;
        return true;
    }
}
```

**问题：没有使用锁或原子操作来保护整个转账过程**，导致中间状态暴露给其他线程，引发误判和反复回滚。

**解决：**

1、**加锁保证原子性**（推荐）：

```java
synchronized (getLockFor(a, b)) { // 按固定顺序加锁
    if (a.balance >= 10) {
        a.balance -= 10;
        b.balance += 10;
    }
}
```

→ 整个转账要么全做，要么不做，

不会出现“扣了钱但没加”的中间态。

2、**如果必须重试，加入随机延迟**：

```java
while (!success) {
    if (tryTransfer(...)) success = true;
    else Thread.sleep(new Random().nextInt(50)); // 打破同步节奏
}
```

→ 让两个线程不太可能每次都同时重试，一方先成功，另一方下次就能看到稳定状态。

> 🔧 **诊断工具**：`jstack` 查死锁、`ThreadMXBean.findDeadlockedThreads()`

### 性能问题（吞吐量 & 延迟）

多线程并发不一定比单线程串行执行快，因为多线程有创建线程和线程上下文切换的开销。

| 瓶颈          | 优化手段      | 对应工具                                                |
| ----------- | --------- | --------------------------------------------------- |
| **线程创建开销大** | 复用线程      | `ThreadPoolExecutor`, `Executors`                   |
| **锁竞争严重**   | 降低粒度 / 无锁 | `ConcurrentHashMap`, `ReadWriteLock`, `StampedLock` |
| **上下文切换频繁** | 控制线程数     | 合理设置线程池 core/maxSize                                |
| **阻塞式 I/O** | 异步非阻塞     | `CompletableFuture`, 虚拟线程（Loom）                     |
| **批量任务效率低** | 按完成顺序处理   | `CompletionService`                                 |

> **现代趋势**：
>
> - **虚拟线程（Java 21+）**：极大降低线程创建成本，简化异步编程
> - **无锁数据结构**：`ConcurrentLinkedQueue`, `Disruptor`（高性能队列）
