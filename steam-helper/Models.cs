using System.Collections.Generic;

namespace SteamHelper
{
    public class Request
    {
        public string command { get; set; }
        public string publisherDir { get; set; }
        public string steamDir { get; set; }
        public string mode { get; set; }
        public string publishedId { get; set; }
        public string contentFolder { get; set; }
        public string title { get; set; }
        public string description { get; set; }
        public string changeNote { get; set; }
        public string visibility { get; set; }
        public string[] tags { get; set; }
        public string previewImage { get; set; }
        public bool includePage { get; set; }
        public string modName { get; set; }
        public string[] publishedIds { get; set; }
    }

    public class ItemDto
    {
        public string publishedId { get; set; }
        public string title { get; set; }
        public string author { get; set; }
        public string authorId { get; set; }
        public bool hiddenByPublisher { get; set; }
        public string installPath { get; set; }
        public string status { get; set; }
        public string error { get; set; }
    }

    public class Result
    {
        public bool ok { get; set; }
        public string error { get; set; }
        public string errorName { get; set; }
        public int errorCode { get; set; }
        public int steamErrorCode { get; set; }
        public string publishedId { get; set; }
        public bool created { get; set; }
        public string accountId { get; set; }
        public string accountName { get; set; }
        public string initResult { get; set; }
        public List<ItemDto> items { get; set; }

        public static Result Fail(string message)
        {
            return new Result
            {
                ok = false,
                error = message,
                items = new List<ItemDto>()
            };
        }
    }
}
