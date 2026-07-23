using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Windows.Services.Store;
using WinRT.Interop;

internal static class Program
{
    private const string RemoveAdsLifetime = "remove_ads_lifetime";
    private const string SoapyPlusMonthly = "soapy_plus_monthly";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            WriteJson(new BridgeError(false, "Missing command or payload.", "InvalidArguments", null));
            return 2;
        }

        StoreBridgePayload payload;
        try
        {
            payload = DecodePayload(args[1]);
        }
        catch
        {
            WriteJson(new BridgeError(false, "The Microsoft Store request was invalid.", "InvalidPayload", null));
            return 2;
        }

        return args[0] switch
        {
            "query" => RunQueryCommand(payload),
            "purchase" => RunPurchaseCommand(payload),
            _ => WriteUnknownCommand(args[0]),
        };
    }

    private static int RunQueryCommand(StoreBridgePayload payload)
    {
        try
        {
            // Store queries do not display UI and can run without a Windows message loop.
            var result = Task.Run(() => QueryAsync(payload)).GetAwaiter().GetResult();
            WriteJson(result);
            return 0;
        }
        catch (Exception ex)
        {
            WriteBridgeException(ex, "Microsoft Store could not load purchase information. Please try again.");
            return 1;
        }
    }

    private static int RunPurchaseCommand(StoreBridgePayload payload)
    {
        using var uiContext = new StaMessageLoopSynchronizationContext();
        var exitCode = 1;
        uiContext.Run(async () =>
        {
            try
            {
                // Every await in PurchaseAsync resumes through this STA Win32 message pump,
                // keeping RequestPurchaseAsync on the UI thread required by WinRT.
                var result = await PurchaseAsync(payload);
                WriteJson(result);
                exitCode = 0;
            }
            catch (Exception ex)
            {
                WriteBridgeException(ex, "Microsoft Store could not complete the purchase. Please try again.");
                exitCode = 1;
            }
        });
        return exitCode;
    }

    private static int WriteUnknownCommand(string command)
    {
        WriteJson(new BridgeError(false, $"Unknown command '{command}'.", "UnknownCommand", null));
        return 2;
    }

    private static StoreBridgePayload DecodePayload(string base64)
    {
        var json = Encoding.UTF8.GetString(Convert.FromBase64String(base64));
        return JsonSerializer.Deserialize<StoreBridgePayload>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
        }) ?? new StoreBridgePayload();
    }

    private static void WriteBridgeException(Exception exception, string fallbackMessage)
    {
        var message = exception is StoreBridgeOperationException
            ? exception.Message
            : fallbackMessage;
        WriteJson(new BridgeError(
            false,
            message,
            ErrorCodeFrom(exception),
            exception.GetType().Name
        ));
    }

    private static void WriteJson<T>(T value)
    {
        Console.Out.Write(JsonSerializer.Serialize(value, JsonOptions));
    }

    private static async Task<QueryResult> QueryAsync(StoreBridgePayload payload)
    {
        var productIds = payload.ProductIds.Length > 0
            ? payload.ProductIds
            : [RemoveAdsLifetime, SoapyPlusMonthly];
        var products = CreateEmptyProducts(productIds);
        var context = StoreContext.GetDefault();
        await ApplyAvailableProductMetadataAsync(context, products);
        var license = await context.GetAppLicenseAsync();
        var now = DateTimeOffset.UtcNow;

        foreach (var pair in license.AddOnLicenses)
        {
            var storeLicense = pair.Value;
            var token = FirstMatchingProductKey(products, storeLicense.InAppOfferToken, pair.Key, storeLicense.SkuStoreId);
            if (string.IsNullOrWhiteSpace(token) || !products.ContainsKey(token))
            {
                continue;
            }

            var active = storeLicense.IsActive && storeLicense.ExpirationDate > now;
            products[token] = products[token] with
            {
                Owned = active,
                Active = active,
                Kind = ProductKindForToken(token),
                ExpiresAt = storeLicense.ExpirationDate.ToUniversalTime().ToString("O"),
            };
        }

        return new QueryResult(products);
    }

    private static async Task ApplyAvailableProductMetadataAsync(
        StoreContext context,
        Dictionary<string, ProductEntitlement> products)
    {
        try
        {
            // Microsoft Store subscription add-ons are returned as Durable products.
            var productKinds = new[] { "Durable" };
            var result = await context.GetAssociatedStoreProductsAsync(productKinds);
            foreach (var pair in result.Products)
            {
                var product = pair.Value;
                var token = FirstMatchingProductKey(products, product.InAppOfferToken, product.StoreId, pair.Key);
                if (string.IsNullOrWhiteSpace(token))
                {
                    continue;
                }

                products[token] = products[token] with
                {
                    Kind = ProductKindForToken(token),
                    Price = ProductPriceFrom(product),
                };
            }
        }
        catch
        {
            // Entitlements must still work when Store price metadata is temporarily unavailable.
        }
    }

    private static async Task<PurchaseResult> PurchaseAsync(StoreBridgePayload payload)
    {
        if (string.IsNullOrWhiteSpace(payload.ProductId))
        {
            return new PurchaseResult(false, "NoProductId", "No product ID was provided.", "NoProductId");
        }

        var context = StoreContext.GetDefault();
        if (payload.WindowHandle > 0)
        {
            InitializeWithWindow.Initialize(context, new IntPtr(payload.WindowHandle));
        }

        var product = await ResolveStoreProductForOfferTokenAsync(context, payload.ProductId);
        if (product is null)
        {
            return new PurchaseResult(
                false,
                "NotFound",
                "This Microsoft Store product is currently unavailable.",
                "ProductNotFound"
            );
        }

        var result = IsMonthlySubscriptionProduct(product, payload.ProductId)
            ? await product.RequestPurchaseAsync()
            : await context.RequestPurchaseAsync(product.StoreId);
        var status = result.Status.ToString();
        var ok = result.Status == StorePurchaseStatus.Succeeded ||
            result.Status == StorePurchaseStatus.AlreadyPurchased;
        return new PurchaseResult(
            ok,
            status,
            ok ? "" : PurchaseErrorMessage(result.Status),
            ok ? null : ErrorCodeFrom(result.ExtendedError)
        );
    }

    private static async Task<StoreProduct?> ResolveStoreProductForOfferTokenAsync(
        StoreContext context,
        string productId)
    {
        // Microsoft Store subscription add-ons are returned as Durable products.
        var productKinds = new[] { "Durable" };
        var result = await context.GetAssociatedStoreProductsAsync(productKinds);
        if (result.ExtendedError is not null)
        {
            throw new StoreBridgeOperationException(
                "Microsoft Store could not load this product. Please try again.",
                result.ExtendedError
            );
        }

        foreach (var pair in result.Products)
        {
            var product = pair.Value;
            if (StringComparer.OrdinalIgnoreCase.Equals(product.InAppOfferToken, productId) ||
                StringComparer.OrdinalIgnoreCase.Equals(product.StoreId, productId) ||
                StringComparer.OrdinalIgnoreCase.Equals(pair.Key, productId))
            {
                return product;
            }
        }
        return null;
    }

    private static bool IsMonthlySubscriptionProduct(StoreProduct product, string requestedProductId)
    {
        return StringComparer.OrdinalIgnoreCase.Equals(requestedProductId, SoapyPlusMonthly) ||
            StringComparer.OrdinalIgnoreCase.Equals(product.InAppOfferToken, SoapyPlusMonthly);
    }

    private static string PurchaseErrorMessage(StorePurchaseStatus status)
    {
        return status switch
        {
            StorePurchaseStatus.NotPurchased => "The purchase was canceled or was not completed.",
            StorePurchaseStatus.NetworkError => "Microsoft Store could not complete the purchase because of a network error.",
            StorePurchaseStatus.ServerError => "Microsoft Store could not complete the purchase because of a server error.",
            _ => "Microsoft Store could not complete the purchase. Please try again.",
        };
    }

    private static Dictionary<string, ProductEntitlement> CreateEmptyProducts(IEnumerable<string> productIds)
    {
        var products = new Dictionary<string, ProductEntitlement>(StringComparer.OrdinalIgnoreCase);
        foreach (var productId in productIds)
        {
            if (string.IsNullOrWhiteSpace(productId)) continue;
            products[productId] = new ProductEntitlement(false, false, ProductKindForToken(productId), null, null);
        }
        return products;
    }

    private static string ProductKindForToken(string token)
    {
        return StringComparer.OrdinalIgnoreCase.Equals(token, SoapyPlusMonthly)
            ? "subscription"
            : "durable";
    }

    private static ProductPrice? ProductPriceFrom(StoreProduct product)
    {
        var price = product.Price;
        if (price is null)
        {
            return null;
        }

        var displayPrice = FirstNonEmpty(
            price.FormattedRecurrencePrice,
            price.FormattedPrice,
            price.FormattedBasePrice
        );
        if (string.IsNullOrWhiteSpace(displayPrice))
        {
            return null;
        }

        return new ProductPrice(
            DisplayPrice: NullIfEmpty(displayPrice),
            FormattedPrice: NullIfEmpty(price.FormattedPrice),
            FormattedBasePrice: NullIfEmpty(price.FormattedBasePrice),
            FormattedRecurrencePrice: NullIfEmpty(price.FormattedRecurrencePrice),
            CurrencyCode: NullIfEmpty(price.CurrencyCode)
        );
    }

    private static string FirstMatchingProductKey(
        Dictionary<string, ProductEntitlement> products,
        params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value) && products.ContainsKey(value))
            {
                return value;
            }
        }
        return "";
    }

    private static string FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value)) return value;
        }
        return "";
    }

    private static string? NullIfEmpty(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private static string? ErrorCodeFrom(Exception? exception)
    {
        return exception is null ? null : $"0x{unchecked((uint)exception.HResult):X8}";
    }
}

internal sealed class StaMessageLoopSynchronizationContext : SynchronizationContext, IDisposable
{
    private const uint WmAppCallback = 0x8001;
    private const uint WmAppComplete = 0x8002;
    private const uint PmNoRemove = 0x0000;

    private readonly ConcurrentQueue<(SendOrPostCallback Callback, object? State)> callbacks = new();
    private readonly uint threadId;
    private bool disposed;

    public StaMessageLoopSynchronizationContext()
    {
        threadId = GetCurrentThreadId();
        // A thread message queue is created lazily. PeekMessage guarantees it exists before
        // worker-thread continuations try to post back to this STA thread.
        PeekMessage(out _, IntPtr.Zero, 0, 0, PmNoRemove);
    }

    public override void Post(SendOrPostCallback callback, object? state)
    {
        if (disposed) return;
        callbacks.Enqueue((callback, state));
        if (!PostThreadMessage(threadId, WmAppCallback, UIntPtr.Zero, IntPtr.Zero))
        {
            throw new InvalidOperationException("Unable to resume the Microsoft Store UI thread.");
        }
    }

    public void Run(Func<Task> operation)
    {
        var previousContext = Current;
        SetSynchronizationContext(this);
        try
        {
            var task = operation();
            task.ContinueWith(
                _ => PostThreadMessage(threadId, WmAppComplete, UIntPtr.Zero, IntPtr.Zero),
                CancellationToken.None,
                TaskContinuationOptions.ExecuteSynchronously,
                TaskScheduler.Default
            );

            while (GetMessage(out var message, IntPtr.Zero, 0, 0) > 0)
            {
                if (message.Message == WmAppCallback)
                {
                    DrainCallbacks();
                    continue;
                }
                if (message.Message == WmAppComplete)
                {
                    break;
                }
                TranslateMessage(ref message);
                DispatchMessage(ref message);
            }

            DrainCallbacks();
            task.GetAwaiter().GetResult();
        }
        finally
        {
            SetSynchronizationContext(previousContext);
        }
    }

    private void DrainCallbacks()
    {
        while (callbacks.TryDequeue(out var work))
        {
            work.Callback(work.State);
        }
    }

    public void Dispose()
    {
        disposed = true;
        while (callbacks.TryDequeue(out _)) { }
    }

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostThreadMessage(
        uint threadId,
        uint message,
        UIntPtr wParam,
        IntPtr lParam
    );

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PeekMessage(
        out NativeMessage message,
        IntPtr windowHandle,
        uint messageFilterMin,
        uint messageFilterMax,
        uint removeMessage
    );

    [DllImport("user32.dll")]
    private static extern int GetMessage(
        out NativeMessage message,
        IntPtr windowHandle,
        uint messageFilterMin,
        uint messageFilterMax
    );

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TranslateMessage(ref NativeMessage message);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref NativeMessage message);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeMessage
    {
        public IntPtr WindowHandle;
        public uint Message;
        public UIntPtr WParam;
        public IntPtr LParam;
        public uint Time;
        public NativePoint Point;
        public uint Private;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint
    {
        public int X;
        public int Y;
    }
}

internal sealed class StoreBridgeOperationException : Exception
{
    public StoreBridgeOperationException(string message, Exception innerException)
        : base(message, innerException)
    {
        HResult = innerException.HResult;
    }
}

internal sealed record StoreBridgePayload(
    string[] ProductIds,
    string ProductId,
    long WindowHandle
)
{
    public StoreBridgePayload() : this([], "", 0) { }
}

internal sealed record ProductEntitlement(
    bool Owned,
    bool Active,
    string Kind,
    string? ExpiresAt,
    ProductPrice? Price
);

internal sealed record ProductPrice(
    string? DisplayPrice,
    string? FormattedPrice,
    string? FormattedBasePrice,
    string? FormattedRecurrencePrice,
    string? CurrencyCode
);

internal sealed record QueryResult(Dictionary<string, ProductEntitlement> Products);

internal sealed record PurchaseResult(bool Ok, string Status, string Error, string? ErrorCode);

internal sealed record BridgeError(bool Ok, string Error, string? ErrorCode, string? ErrorType);
