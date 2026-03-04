import { BaseClient } from './base.js';
import type { Tweet, PaginatedResult, SearchOptions } from '../../types/twitter.js';

export class SearchMixin extends BaseClient {
  async search(query: string, options: SearchOptions = {}): Promise<PaginatedResult<Tweet>> {
    const { type = 'top', count = 20, cursor } = options;

    const productMap: Record<string, string> = {
      top: 'Top',
      latest: 'Latest',
      people: 'People',
      photos: 'Photos',
      videos: 'Videos',
    };

    const data = await this.graphql<any>('SearchTimeline', {
      rawQuery: query,
      count,
      cursor,
      querySource: 'typed_query',
      product: productMap[type] || 'Top',
    });

    return this.parseSearchResults(data);
  }

  private parseSearchResults(data: any): PaginatedResult<Tweet> {
    const instructions = data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];
    const entries = instructions
      .find((i: any) => i.type === 'TimelineAddEntries')
      ?.entries || [];

    const tweets: Tweet[] = [];
    let cursor: string | undefined;

    for (const entry of entries) {
      if (entry.content?.itemContent?.tweet_results?.result) {
        try {
          tweets.push(this.parseTweetFromSearch(entry.content.itemContent.tweet_results.result));
        } catch (e) {
          // Skip unavailable tweets
        }
      }
      if (entry.content?.cursorType === 'Bottom') {
        cursor = entry.content.value;
      }
    }

    return {
      items: tweets,
      cursor,
      hasMore: !!cursor,
    };
  }

  private parseTweetFromSearch(result: any): Tweet {
    // Reuse tweet parsing logic from TweetMixin
    const tweetData = result.tweet || result;
    const legacy = tweetData.legacy;
    const core = tweetData.core?.user_results?.result;

    return {
      id: tweetData.rest_id,
      text: this.extractTweetText(tweetData),
      createdAt: legacy.created_at,
      user: core ? this.parseUserFromSearch(core) : null as any,
      replyCount: legacy.reply_count,
      retweetCount: legacy.retweet_count,
      likeCount: legacy.favorite_count,
      quoteCount: legacy.quote_count,
      viewCount: tweetData.views?.count ? parseInt(tweetData.views.count) : undefined,
      bookmarkCount: legacy.bookmark_count,
      isRetweet: !!legacy.retweeted_status_result,
      isQuote: !!legacy.is_quote_status,
      isReply: !!legacy.in_reply_to_status_id_str,
      inReplyToTweetId: legacy.in_reply_to_status_id_str,
      inReplyToUserId: legacy.in_reply_to_user_id_str,
      conversationId: legacy.conversation_id_str,
      lang: legacy.lang,
    };
  }

  private parseUserFromSearch(result: any): any {
    const legacy = result.legacy;
    return {
      id: result.id,
      restId: result.rest_id,
      name: legacy.name,
      screenName: legacy.screen_name,
      profileImageUrl: legacy.profile_image_url_https,
      verified: legacy.verified,
      isBlueVerified: result.is_blue_verified || false,
    };
  }
}
