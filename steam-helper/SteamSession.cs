using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using SteamLayerWrap;

namespace SteamHelper
{
    internal static class SteamSession
    {
        private const int DayZAppId = 221100;
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);
        private static string configuredSteamDir = string.Empty;
        private static readonly string[] DefaultTags =
        {
            "Weapons", "Vehicles", "Clothing", "Buildings", "Food", "Medical", "Tools", "Misc", "Server", "Book"
        };

        private static readonly Dictionary<int, string> EResultNames = new Dictionary<int, string>
        {
            { 1, "OK" },
            { 2, "Fail" },
            { 3, "NoConnection" },
            { 5, "InvalidPassword" },
            { 8, "InvalidParam" },
            { 9, "FileNotFound" },
            { 10, "Busy" },
            { 11, "InvalidState" },
            { 15, "AccessDenied" },
            { 16, "Timeout" },
            { 21, "Pending" },
            { 24, "InsufficientPrivilege" },
            { 25, "LimitExceeded" }
        };

        public static Result Run(Request request)
        {
            configuredSteamDir = request == null ? string.Empty : (request.steamDir ?? string.Empty).Trim();
            var command = (request.command ?? string.Empty).Trim().ToLowerInvariant();
            if (command == "list")
            {
                return List(request);
            }

            if (command == "upload")
            {
                return Upload(request);
            }

            if (command == "fetch")
            {
                return Fetch(request);
            }

            return Result.Fail("Unknown command.");
        }

        private static Result List(Request request)
        {
            var api = Connect(request, out var status, out var items);
            var result = new Result
            {
                ok = status == InitResult.Online || status == InitResult.AlreadyInitialized,
                initResult = status.ToString(),
                items = items,
                accountId = SafeAccountId(api),
                accountName = SafeAccountName(api)
            };
            if (!result.ok)
            {
                result.error = "Steam init returned " + result.initResult + ".";
            }

            return result;
        }

        private static Result Upload(Request request)
        {
            var mode = (request.mode ?? "normal").Trim().ToLowerInvariant();
            if (mode != "normal" && mode != "contributor")
            {
                return Result.Fail("Unknown upload mode.");
            }

            if (string.IsNullOrWhiteSpace(request.contentFolder) || !Directory.Exists(request.contentFolder))
            {
                return Result.Fail("Choose a content folder that exists.");
            }

            if (!string.IsNullOrWhiteSpace(request.previewImage) && !File.Exists(request.previewImage))
            {
                return Result.Fail("Preview image was not found.");
            }

            ulong publishedId;
            try
            {
                publishedId = ParseId(request.publishedId);
            }
            catch (InvalidOperationException ex)
            {
                return Result.Fail(ex.Message);
            }

            if (mode == "contributor" && publishedId == 0)
            {
                return Result.Fail("Contributor upload needs a published file id.");
            }

            SteamAPIWrap api = Connect(request, out var status, out var items);
            if (status != InitResult.Online && status != InitResult.AlreadyInitialized)
                {
                    var failed = Result.Fail("Steam init returned " + status + ".");
                    failed.initResult = status.ToString();
                    failed.accountId = SafeAccountId(api);
                    failed.accountName = SafeAccountName(api);
                    return failed;
                }

                var publisher = api.Publisher;
                if (publisher == null)
                {
                    return Result.Fail("The DayZ Publisher upload service is not available.");
                }

                publisher.OnProgressChanged += (sender, args) => Console.Error.WriteLine("progress " + args.Progress);

                var created = false;
                if (mode == "normal" && publishedId == 0)
                {
                    var createdResult = CreateWorkshopItem(publisher);
                    if (!createdResult.ok)
                    {
                        return createdResult;
                    }

                    publishedId = ulong.Parse(createdResult.publishedId, CultureInfo.InvariantCulture);
                    created = true;
                }
                else if (mode == "normal")
                {
                    var owned = FindItem(items, publishedId);
                    if (owned == null || owned.hiddenByPublisher)
                    {
                        return Result.Fail("This account is not the author of that workshop item. Switch the mod to Contributor to update it without creating a new one.");
                    }
                }

                WriteMeta(request.contentFolder, publishedId, request.modName);
                Console.Error.WriteLine("Wrote meta.cpp for " + publishedId.ToString(CultureInfo.InvariantCulture));
                var descriptor = BuildDescriptor(request, publishedId);
                var contentOnly = mode == "contributor" && !request.includePage;
                var published = Submit(publisher, descriptor, publishedId, contentOnly);
                published.created = created;
                published.accountId = SafeAccountId(api);
                published.accountName = SafeAccountName(api);
                published.initResult = status.ToString();
                if (publishedId != 0)
                {
                    published.publishedId = publishedId.ToString(CultureInfo.InvariantCulture);
                }

                return published;
        }

        private static SteamAPIWrap Connect(Request request, out InitResult status, out List<ItemDto> items)
        {
            try
            {
                LoggingService.Init();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Logger init: " + ex.Message);
            }

            var api = new SteamAPIWrap();
            var arrived = new ManualResetEventSlim(false);
            var seen = new List<ItemDto>();
            api.PublishedListChanged += (sender, args) =>
            {
                var copied = CopyItems(api, args == null ? null : args.List);
                Console.Error.WriteLine("published list event " + copied.Count);
                if (copied.Count == 0)
                {
                    return;
                }

                seen = copied;
                arrived.Set();
            };
            var tags = MergeTags(request.tags);
            status = api.Init(tags, tags, new[] { DayZAppId }, true);
            if (status != InitResult.Online && status != InitResult.AlreadyInitialized && status != InitResult.Offline)
            {
                items = seen;
                return api;
            }

            NativeMethods.Wait(arrived, 20000);
            if (seen.Count == 0)
            {
                try
                {
                    seen = CopyItems(api, api.GetPublishedContentList());
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("Published list: " + ex.GetBaseException().Message);
                }
            }

            var accountId = SafeAccountId(api);
            foreach (var item in seen)
            {
                item.hiddenByPublisher = item.authorId != accountId;
            }

            items = seen;
            return api;
        }

        private static List<ItemDto> CopyItems(SteamAPIWrap api, IEnumerable<SteamFileInfoWrap> list)
        {
            var items = new List<ItemDto>();
            if (list == null)
            {
                return items;
            }

            var accountId = SafeAccountId(api);
            var seenIds = new HashSet<string>();
            foreach (var item in list)
            {
                if (item == null)
                {
                    continue;
                }

                var publishedId = item.PublishedId.ToString(CultureInfo.InvariantCulture);
                if (!seenIds.Add(publishedId))
                {
                    continue;
                }

                var authorId = item.AuthorId.ToString(CultureInfo.InvariantCulture);
                items.Add(new ItemDto
                {
                    publishedId = publishedId,
                    title = item.Title ?? string.Empty,
                    author = item.Author ?? string.Empty,
                    authorId = authorId,
                    hiddenByPublisher = authorId != accountId
                });
            }

            items.Sort((left, right) => string.Compare(left.title, right.title, StringComparison.OrdinalIgnoreCase));
            return items;
        }

        private static Result CreateWorkshopItem(PublisherWrap publisher)
        {
            ulong createdId = 0;
            string message = null;
            var errorCode = 0;
            var steamCode = 0;
            var failed = false;
            var done = new ManualResetEventSlim(false);
            publisher.OnCreateItemComplete += (sender, args) =>
            {
                createdId = args.PublishedId;
                done.Set();
            };
            publisher.OnCreateItemFailed += (sender, args) =>
            {
                failed = true;
                errorCode = args.ErrorCode;
                steamCode = args.SteamErrorCode;
                message = args.ErrorMessage;
                done.Set();
            };
            publisher.CreateItem();
            if (!NativeMethods.Wait(done, 120000) || failed || createdId == 0)
            {
                return FailSteam(errorCode, steamCode, message ?? "Creating the workshop item failed.");
            }

            return new Result
            {
                ok = true,
                publishedId = createdId.ToString(CultureInfo.InvariantCulture),
                created = true
            };
        }

        private static Result Submit(PublisherWrap publisher, PublishDesc descriptor, ulong publishedId, bool contentOnly)
        {
            string message = null;
            var errorCode = 0;
            var steamCode = 0;
            var failed = false;
            var done = new ManualResetEventSlim(false);
            publisher.OnPublishComplete += (sender, args) => done.Set();
            publisher.OnPublishFail += (sender, args) =>
            {
                failed = true;
                errorCode = args.ErrorCode;
                steamCode = args.SteamErrorCode;
                message = args.ErrorMessage;
                if (args.PublishedId != 0)
                {
                    descriptor.PublishedId = args.PublishedId;
                }

                done.Set();
            };

            if (contentOnly)
            {
                Console.Error.WriteLine("Calling UpdateContentOnly. Workshop text is not included.");
                publisher.UpdateContentOnly(descriptor, publishedId);
            }
            else
            {
                Console.Error.WriteLine("Calling Update. Workshop text and files are included.");
                publisher.Update(descriptor, publishedId);
            }

            if (!NativeMethods.Wait(done, 30 * 60 * 1000))
            {
                return FailSteam(0, 16, "The workshop upload timed out.");
            }

            if (failed)
            {
                return FailSteam(errorCode, steamCode, message ?? "Steam rejected the upload.");
            }

            return new Result
            {
                ok = true,
                publishedId = publishedId.ToString(CultureInfo.InvariantCulture),
                items = new List<ItemDto>()
            };
        }

        private static PublishDesc BuildDescriptor(Request request, ulong publishedId)
        {
            var tags = new List<string>();
            if (request.tags != null)
            {
                foreach (var tag in request.tags)
                {
                    if (!string.IsNullOrWhiteSpace(tag))
                    {
                        tags.Add(tag.Trim());
                    }
                }
            }

            var name = string.IsNullOrWhiteSpace(request.title) ? request.modName ?? string.Empty : request.title;
            var descriptor = new PublishDesc
            {
                PublishedId = publishedId,
                ContentPath = request.contentFolder,
                ContentSize = FolderSize(request.contentFolder),
                Name = name,
                Desc = request.description ?? string.Empty,
                ChangeNotes = request.changeNote ?? string.Empty,
                Tags = tags,
                Visibility = VisibilityCode(request.visibility),
                KeysToAdd = new List<KeyValuePair<string, string>>(),
                KeysToRemove = new List<string>()
            };
            if (!string.IsNullOrWhiteSpace(request.previewImage))
            {
                descriptor.PrevFile = request.previewImage;
            }

            return descriptor;
        }

        private static void WriteMeta(string folder, ulong publishedId, string name)
        {
            var timestamp = DateTime.UtcNow.ToBinary().ToString(CultureInfo.InvariantCulture);
            var lines = string.Join("\r\n", new[]
            {
                "protocol = 1;",
                "publishedid = " + publishedId.ToString(CultureInfo.InvariantCulture) + ";",
                "name = \"" + EscapeQuoted(name) + "\";",
                "timestamp = " + timestamp + ";"
            });
            File.WriteAllText(Path.Combine(folder, "meta.cpp"), lines + "\r\n", Utf8);
        }

        private static string EscapeQuoted(string value)
        {
            return (value ?? string.Empty).Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r\n", "\\n").Replace("\n", "\\n").Replace("\r", "\\n");
        }

        private static ulong FolderSize(string folder)
        {
            ulong total = 0;
            foreach (var file in Directory.EnumerateFiles(folder, "*", SearchOption.AllDirectories))
            {
                total += (ulong)new FileInfo(file).Length;
            }

            return total;
        }

        private static int VisibilityCode(string name)
        {
            if (string.Equals(name, "friends", StringComparison.OrdinalIgnoreCase))
            {
                return 1;
            }

            if (string.Equals(name, "private", StringComparison.OrdinalIgnoreCase))
            {
                return 2;
            }

            return 0;
        }

        private static ulong ParseId(string text)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                return 0;
            }

            ulong id;
            if (!ulong.TryParse(text.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out id))
            {
                throw new InvalidOperationException("Published file id must be a number.");
            }

            return id;
        }

        private static string[] MergeTags(string[] extra)
        {
            var tags = new List<string>(DefaultTags);
            if (extra != null)
            {
                foreach (var tag in extra)
                {
                    if (!string.IsNullOrWhiteSpace(tag) && !tags.Contains(tag.Trim()))
                    {
                        tags.Add(tag.Trim());
                    }
                }
            }

            return tags.ToArray();
        }

        private static ItemDto FindItem(List<ItemDto> items, ulong publishedId)
        {
            var text = publishedId.ToString(CultureInfo.InvariantCulture);
            foreach (var item in items)
            {
                if (item.publishedId == text)
                {
                    return item;
                }
            }

            return null;
        }

        private static Result FailSteam(int errorCode, int steamCode, string message)
        {
            string name;
            EResultNames.TryGetValue(steamCode, out name);
            return new Result
            {
                ok = false,
                error = string.IsNullOrWhiteSpace(message) ? "Steam rejected the upload." : message,
                errorName = name,
                errorCode = errorCode,
                steamErrorCode = steamCode,
                items = new List<ItemDto>()
            };
        }

        private static Result Fetch(Request request)
        {
            var ids = new List<string>();
            if (request.publishedIds != null)
            {
                ids.AddRange(request.publishedIds);
            }

            if (!string.IsNullOrWhiteSpace(request.publishedId))
            {
                ids.Add(request.publishedId.Trim());
            }

            var api = Connect(request, out var status, out _);
            var result = new Result
            {
                ok = status == InitResult.Online || status == InitResult.AlreadyInitialized,
                initResult = status.ToString(),
                accountId = SafeAccountId(api),
                accountName = SafeAccountName(api),
                items = new List<ItemDto>()
            };
            if (!result.ok)
            {
                result.error = "Steam init returned " + result.initResult + ".";
                return result;
            }

            IUGCDownloadMonitorWrap monitor = null;
            try
            {
                monitor = api.UGCDownloadMonitor;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("download monitor: " + ex.GetBaseException().Message);
            }

            var seen = new HashSet<string>();
            foreach (var raw in ids)
            {
                var text = (raw ?? string.Empty).Trim();
                if (!seen.Add(text))
                {
                    continue;
                }

                ulong id;
                try
                {
                    id = ParseId(text);
                }
                catch (InvalidOperationException ex)
                {
                    result.items.Add(new ItemDto
                    {
                        publishedId = text,
                        status = "missing",
                        error = ex.Message,
                        installPath = string.Empty
                    });
                    continue;
                }

                if (id == 0)
                {
                    result.items.Add(new ItemDto
                    {
                        publishedId = text,
                        status = "missing",
                        error = "Published file id is empty.",
                        installPath = string.Empty
                    });
                    continue;
                }

                var installPath = DownloadWorkshopItem(api, monitor, id);
                result.items.Add(new ItemDto
                {
                    publishedId = id.ToString(CultureInfo.InvariantCulture),
                    status = string.IsNullOrEmpty(installPath) ? "missing" : "ready",
                    installPath = installPath ?? string.Empty,
                    error = string.IsNullOrEmpty(installPath) ? "Steam did not install this workshop item." : string.Empty
                });
            }

            return result;
        }

        private static string DownloadWorkshopItem(SteamAPIWrap api, IUGCDownloadMonitorWrap monitor, ulong id)
        {
            var existing = InstalledFolder(monitor, id);
            if (!string.IsNullOrEmpty(existing))
            {
                Console.Error.WriteLine("already installed " + id + " " + existing);
                return existing;
            }

            try
            {
                api.Subscribe(id);
                Console.Error.WriteLine("subscribed " + id);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("subscribe " + id + ": " + ex.GetBaseException().Message);
            }

            using (var pause = new ManualResetEventSlim(false))
            {
                NativeMethods.Wait(pause, 2000);
            }

            var requested = false;
            if (monitor != null)
            {
                try
                {
                    requested = monitor.RequestItemDownload(id, true);
                    Console.Error.WriteLine("download " + id + " requested=" + requested);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("download " + id + ": " + ex.GetBaseException().Message);
                }
            }

            var timeoutMs = requested ? 180000 : 20000;
            var start = Environment.TickCount;
            using (var pause = new ManualResetEventSlim(false))
            {
                while (unchecked(Environment.TickCount - start) < timeoutMs)
                {
                    var folder = InstalledFolder(monitor, id);
                    if (!string.IsNullOrEmpty(folder))
                    {
                        return folder;
                    }

                    NativeMethods.Wait(pause, 500);
                }
            }

            return null;
        }

        private static string InstalledFolder(IUGCDownloadMonitorWrap monitor, ulong id)
        {
            if (monitor != null)
            {
                try
                {
                    var info = monitor.GetItemInstallInfo(id);
                    if (info != null && HasFiles(info.InstallPath))
                    {
                        return info.InstallPath;
                    }
                }
                catch (InvalidOperationException)
                {
                    // Steam reports this until the workshop item has a folder.
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("install info " + id + ": " + ex.GetBaseException().Message);
                }
            }

            if (!string.IsNullOrWhiteSpace(configuredSteamDir))
            {
                var fromSettings = Path.Combine(
                    configuredSteamDir,
                    "steamapps",
                    "workshop",
                    "content",
                    "221100",
                    id.ToString(CultureInfo.InvariantCulture));
                if (HasFiles(fromSettings))
                {
                    return fromSettings;
                }
            }

            var conventional = Path.Combine(
                @"C:\Program Files (x86)\Steam\steamapps\workshop\content\221100",
                id.ToString(CultureInfo.InvariantCulture));
            return HasFiles(conventional) ? conventional : null;
        }

        private static bool HasFiles(string folder)
        {
            if (string.IsNullOrWhiteSpace(folder) || !Directory.Exists(folder))
            {
                return false;
            }

            try
            {
                using (var files = Directory.EnumerateFiles(folder, "*", SearchOption.AllDirectories).GetEnumerator())
                {
                    return files.MoveNext();
                }
            }
            catch (Exception)
            {
                return false;
            }
        }

        private static string SafeAccountId(SteamAPIWrap api)
        {
            try
            {
                return api.UserAccountId.ToString(CultureInfo.InvariantCulture);
            }
            catch (Exception)
            {
                return string.Empty;
            }
        }

        private static string SafeAccountName(SteamAPIWrap api)
        {
            try
            {
                return api.UserNickName ?? string.Empty;
            }
            catch (Exception)
            {
                return string.Empty;
            }
        }
    }
}
