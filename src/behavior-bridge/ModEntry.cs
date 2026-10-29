// BehaviorBridge: 把"行为学"(BehaviorAutomation, Nexus 52289)的框选作业暴露成 HTTP,
// 让 AI 脚本(programmatic select)替代 Shift+拖框的物理操作。
// 复刻 ModEntry.Tick 里拖框松开时的调用:
//   Controller.Clear();
//   Controller.Board.Select(location, player, mode, tool,
//       SelectionGeometry.Rectangle(start, end, MaxSelectionSize), config, material, smart);
//   Controller.Resume();
// 注意: 行为学自身 tick 要求 Game1.game1.IsActive(游戏窗口在前台)才推进作业 —— 与
// AI 挂机的"星露谷必须在前台"互锁政策一致, 后台时会自动暂停。
using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using StardewModdingAPI;
using StardewModdingAPI.Events;
using StardewValley;
using Sznine.BehaviorAutomation;

namespace BehaviorBridge;

public sealed class ModEntry : Mod
{
    private Sznine.BehaviorAutomation.ModEntry behavior;
    private System.Reflection.FieldInfo configField;
    private readonly ConcurrentQueue<(Func<object> Work, TaskCompletionSource<object> Done)> queue = new();
    private HttpListener listener;

    public override void Entry(IModHelper helper)
    {
        Resolve();
        helper.Events.GameLoop.GameLaunched += (_, _) => Resolve();
        helper.Events.GameLoop.UpdateTicking += Tick;
        StartListener();
    }

    private void Resolve()
    {
        if (behavior != null) return;
        var info = Helper.ModRegistry.Get("sznine.BehaviorAutomation");
        // IModInfo 接口不暴露 Mod 实例, 走反射取具体类型的 Mod 属性
        var modObj = info == null ? null : info.GetType().GetProperty("Mod")?.GetValue(info);
        var mod = modObj as Sznine.BehaviorAutomation.ModEntry;
        if (mod == null) return;
        behavior = mod;
        configField = typeof(Sznine.BehaviorAutomation.ModEntry).GetField("config",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
        Monitor.Log("已挂接行为学 BehaviorAutomation → 桥接口 http://localhost:7845", LogLevel.Info);
    }

    private ModConfig Config => (ModConfig)configField.GetValue(behavior);

    // 游戏线程执行队列里的命令(游戏对象只能在主线程碰)
    private void Tick(object? sender, UpdateTickingEventArgs e)
    {
        while (queue.TryDequeue(out var job))
        {
            try { job.Done.TrySetResult(job.Work()); }
            catch (Exception ex) { job.Done.TrySetException(ex); }
        }
    }

    // ================= HTTP =================
    private void StartListener()
    {
        listener = new HttpListener();
        listener.Prefixes.Add("http://localhost:7845/");
        try { listener.Start(); }
        catch (Exception ex)
        {
            Monitor.Log("桥接端口 7845 启动失败: " + ex.Message, LogLevel.Error);
            return;
        }
        _ = Task.Run(async () =>
        {
            while (listener.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = await listener.GetContextAsync(); }
                catch { return; }
                _ = Handle(ctx);
            }
        });
        Monitor.Log("BehaviorBridge listening on http://localhost:7845", LogLevel.Info);
    }

    private async Task Handle(HttpListenerContext ctx)
    {
        try
        {
            string body = "";
            if (ctx.Request.HasEntityBody)
                body = await new System.IO.StreamReader(ctx.Request.InputStream, Encoding.UTF8).ReadToEndAsync();
            string path = ctx.Request.Url?.AbsolutePath ?? "/";
            if (path == "/")
            {
                Respond(ctx, new
                {
                    name = "BehaviorBridge",
                    version = "1.0.0",
                    behaviorLoaded = behavior != null,
                    endpoints = new[]
                    {
                        "GET /status", "POST /select {x1,y1,x2,y2,button:left|right}",
                        "POST /clear", "POST /pause", "POST /resume",
                        "GET /actions", "POST /actions {scope:held|leftExtra|smart,kind,enable}"
                    }
                });
                return;
            }
            if (behavior == null) { Respond(ctx, new { error = "行为学 mod 未加载" }, 500); return; }

            Func<object> work;
            switch (path)
            {
                case "/status": work = Status; break;
                case "/select": work = () => Select(Parse(body)); break;
                case "/clear":
                    work = () => { behavior.Controller.Clear(); return (object)new { ok = true, state = behavior.Controller.State }; };
                    break;
                case "/pause":
                    work = () => { behavior.Controller.Pause("bridge-paused"); return (object)new { ok = true, state = behavior.Controller.State }; };
                    break;
                case "/resume":
                    work = () => { behavior.Controller.Resume(); return (object)new { ok = true, state = behavior.Controller.State }; };
                    break;
                case "/actions":
                    work = () => (object)(ctx.Request.HttpMethod == "POST" ? SetActions(Parse(body)) : GetActions());
                    break;
                default: Respond(ctx, new { error = "unknown endpoint " + path }, 404); return;
            }
            var done = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
            queue.Enqueue((work, done));
            var result = await done.Task.WaitAsync(TimeSpan.FromSeconds(15));
            Respond(ctx, result);
        }
        catch (Exception ex)
        {
            try { Respond(ctx, new { error = ex.Message }, 500); } catch { }
        }
    }

    // ================= 端点实现 =================
    private object Status()
    {
        var c = behavior.Controller;
        var dt = c.DisplayedTask;
        object task = null;
        if (dt != null)
            task = new { x = dt.Origin.X, y = dt.Origin.Y, kind = dt.Kind.ToString(), mode = dt.Mode.ToString() };
        return new
        {
            behaviorEnabled = Config.Enabled,
            hasSession = c.HasSession,
            state = c.State,
            paused = c.Paused,
            active = c.Active != null,
            jobs = c.Board.Jobs.Count,
            generation = c.Board.Generation,
            location = Game1.currentLocation?.Name,
            currentTask = task,
            windowActive = Game1.game1.IsActive
        };
    }

    // 等价于 Shift+拖框后松手; button 默认 right(智能换工具池)
    private object Select(JsonElement b)
    {
        if (!Context.IsWorldReady || Game1.currentLocation == null)
            throw new InvalidOperationException("世界未就绪");
        if (!Sznine.BehaviorAutomation.ModEntry.Editable())
            throw new InvalidOperationException("菜单/事件/对话框占用中, 不可框选");
        int x1 = b.GetProperty("x1").GetInt32();
        int y1 = b.GetProperty("y1").GetInt32();
        int x2 = b.GetProperty("x2").GetInt32();
        int y2 = b.GetProperty("y2").GetInt32();
        bool smart = !b.TryGetProperty("button", out var bt) || bt.GetString() != "left";

        var who = Game1.player;
        var mode = ModeInfo.From(who.CurrentItem) ?? ToolMode.Hand;
        var material = smart ? null : who.CurrentItem?.getOne() as StardewValley.Object;
        var cfg = Config;
        cfg.Enabled = true; // 桥接模式强制开总开关
        behavior.Controller.Clear();
        var rect = SelectionGeometry.Rectangle(new Cell(x1, y1), new Cell(x2, y2), 64);
        var (added, removed) = behavior.Controller.Board.Select(Game1.currentLocation, who,
            mode, who.CurrentTool, rect, cfg, material, smart);
        behavior.Controller.Resume();
        Monitor.Log($"bridge select ({x1},{y1})-({x2},{y2}) smart={smart} mode={mode} added={added} removed={removed}", LogLevel.Info);
        return new { ok = true, added, removed, mode = mode.ToString(), smart, state = behavior.Controller.State };
    }

    private object GetActions()
    {
        var cfg = Config;
        return new
        {
            enabled = cfg.Enabled,
            all = Enum.GetNames<ActionKind>(),
            held = cfg.Actions.Select(k => k.ToString()).OrderBy(s => s).ToArray(),
            leftExtra = cfg.LeftActions.Select(k => k.ToString()).OrderBy(s => s).ToArray(),
            smart = cfg.SmartActions.Select(k => k.ToString()).OrderBy(s => s).ToArray()
        };
    }

    private object SetActions(JsonElement b)
    {
        var cfg = Config;
        string scope = (b.GetProperty("scope").GetString() ?? "").ToLowerInvariant();
        var kind = Enum.Parse<ActionKind>(b.GetProperty("kind").GetString()!, true);
        bool enable = !b.TryGetProperty("enable", out var en) || en.GetBoolean();
        System.Collections.Generic.HashSet<ActionKind> set = scope switch
        {
            "held" => cfg.Actions,
            "leftextra" or "left" => cfg.LeftActions,
            "smart" or "right" => cfg.SmartActions,
            _ => throw new ArgumentException("scope 必须是 held|leftExtra|smart")
        };
        if (enable) set.Add(kind); else set.Remove(kind);
        typeof(Sznine.BehaviorAutomation.ModEntry)
            .GetMethod("SaveConfig", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)
            ?.Invoke(behavior, null);
        return GetActions();
    }

    // ================= 工具 =================
    private static JsonElement Parse(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return default;
        return JsonDocument.Parse(body).RootElement.Clone();
    }

    private static void Respond(HttpListenerContext ctx, object payload, int code = 200)
    {
        var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        var buf = Encoding.UTF8.GetBytes(json);
        ctx.Response.StatusCode = code;
        ctx.Response.ContentType = "application/json; charset=utf-8";
        ctx.Response.ContentLength64 = buf.Length;
        ctx.Response.OutputStream.Write(buf, 0, buf.Length);
        ctx.Response.OutputStream.Close();
    }
}
