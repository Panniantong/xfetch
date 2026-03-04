import { BaseClient } from './base.js';
import type { Tweet, PaginatedResult } from '../../types/twitter.js';

export class TweetMixin extends BaseClient {
  async getTweet(tweetId: string): Promise<Tweet> {
    const data = await this.graphql<any>('TweetDetail', {
      focalTweetId: tweetId,
      with_rux_injections: false,
      includePromotedContent: false,
      withCommunity: true,
      withQuickPromoteEligibilityTweetFields: false,
      withBirdwatchNotes: false,
      withVoice: true,
      withV2Timeline: true,
    });

    const instructions = data?.threaded_conversation_with_injections_v2?.instructions || [];
    const entries = instructions
      .find((i: any) => i.type === 'TimelineAddEntries')
      ?.entries || [];

    for (const entry of entries) {
      if (entry.entryId?.startsWith('tweet-')) {
        const tweetResult = entry.content?.itemContent?.tweet_results?.result;
        if (tweetResult?.rest_id === tweetId || tweetResult?.tweet?.rest_id === tweetId) {
          return this.parseTweet(tweetResult);
        }
      }
    }

    throw new Error(`Tweet not found: ${tweetId}`);
  }

  async getUserTweets(userId: string, count = 20, cursor?: string): Promise<PaginatedResult<Tweet>> {
    const data = await this.graphql<any>('UserTweets', {
      userId,
      count,
      cursor,
      includePromotedContent: false,
      withQuickPromoteEligibilityTweetFields: false,
      withVoice: true,
      withV2Timeline: true,
    });

    return this.parseTweetList(data);
  }

  async getUserTweetsAndReplies(userId: string, count = 20, cursor?: string): Promise<PaginatedResult<Tweet>> {
    const data = await this.graphql<any>('UserTweetsAndReplies', {
      userId,
      count,
      cursor,
      includePromotedContent: false,
      withCommunity: true,
      withVoice: true,
      withV2Timeline: true,
    });

    return this.parseTweetList(data);
  }

  async getThread(tweetId: string): Promise<Tweet[]> {
    const data = await this.graphql<any>('TweetDetail', {
      focalTweetId: tweetId,
      with_rux_injections: false,
      includePromotedContent: false,
      withCommunity: true,
      withQuickPromoteEligibilityTweetFields: false,
      withBirdwatchNotes: false,
      withVoice: true,
      withV2Timeline: true,
    });

    const instructions = data?.threaded_conversation_with_injections_v2?.instructions || [];
    const entries = instructions
      .find((i: any) => i.type === 'TimelineAddEntries')
      ?.entries || [];

    const tweets: Tweet[] = [];

    for (const entry of entries) {
      if (entry.entryId?.startsWith('tweet-') || entry.entryId?.startsWith('conversationthread-')) {
        const tweetResult = entry.content?.itemContent?.tweet_results?.result;
        if (tweetResult) {
          tweets.push(this.parseTweet(tweetResult));
        }
        
        // Handle thread items
        if (entry.content?.items) {
          for (const item of entry.content.items) {
            const threadTweet = item.item?.itemContent?.tweet_results?.result;
            if (threadTweet) {
              tweets.push(this.parseTweet(threadTweet));
            }
          }
        }
      }
    }

    return tweets;
  }

  protected parseTweet(result: any): Tweet {
    // Handle tombstones and unavailable tweets
    if (result.__typename === 'TweetTombstone') {
      throw new Error('Tweet is unavailable');
    }

    // Handle TweetWithVisibilityResults wrapper
    const tweetData = result.tweet || result;
    const legacy = tweetData.legacy;
    const core = tweetData.core?.user_results?.result;

    return {
      id: tweetData.rest_id,
      text: this.extractTweetText(tweetData),
      createdAt: legacy.created_at,
      user: core ? this.parseUserFromTweet(core) : null as any,
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
      media: this.parseMedia(legacy.extended_entities?.media),
    };
  }

  private parseUserFromTweet(result: any): any {
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

  private parseMedia(media: any[]): any[] {
    if (!media) return [];
    
    return media.map(m => ({
      type: m.type,
      url: m.media_url_https,
      width: m.original_info?.width,
      height: m.original_info?.height,
      altText: m.ext_alt_text,
    }));
  }

  protected parseTweetList(data: any): PaginatedResult<Tweet> {
    // X API returns timeline (not timeline_v2) for UserTweets
    const instructions = data?.user?.result?.timeline_v2?.timeline?.instructions 
      || data?.user?.result?.timeline?.timeline?.instructions 
      || [];
    
    const tweets: Tweet[] = [];
    let cursor: string | undefined;

    for (const instruction of instructions) {
      // Handle TimelineAddEntries (main tweets list)
      if (instruction.type === 'TimelineAddEntries') {
        for (const entry of instruction.entries || []) {
          if (entry.content?.itemContent?.tweet_results?.result) {
            try {
              tweets.push(this.parseTweet(entry.content.itemContent.tweet_results.result));
            } catch (e) {
              // Skip unavailable tweets
            }
          }
          if (entry.content?.cursorType === 'Bottom') {
            cursor = entry.content.value;
          }
        }
      }
      
      // Handle TimelinePinEntry (pinned tweet - single entry)
      if (instruction.type === 'TimelinePinEntry' && instruction.entry) {
        const entry = instruction.entry;
        if (entry.content?.itemContent?.tweet_results?.result) {
          try {
            tweets.push(this.parseTweet(entry.content.itemContent.tweet_results.result));
          } catch (e) {
            // Skip unavailable tweets
          }
        }
      }
    }

    return {
      items: tweets,
      cursor,
      hasMore: !!cursor,
    };
  }
}
