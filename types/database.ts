/**
 * Generated from the harness PostgreSQL 16 cluster after every migration
 * in supabase/migrations. Regenerate with `npm run db:types`.
 * `npm run db:types:check` fails when this file has drifted.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      account_retention_ledger: {
        Row: {
          account_user_id: string;
          retired_handle: string | null;
          profile_id: string | null;
          deleted_at: string;
          pint_drop_ids: string[];
          visit_report_ids: string[];
          community_price_ids: string[];
          weather_recommendation_ids: string[];
          night_memory_ids: string[];
          night_moment_ids: string[];
          venue_photo_ids: string[];
        };
        Insert: {
          account_user_id: string;
          retired_handle?: string | null;
          profile_id?: string | null;
          deleted_at?: string;
          pint_drop_ids?: string[];
          visit_report_ids?: string[];
          community_price_ids?: string[];
          weather_recommendation_ids?: string[];
          night_memory_ids?: string[];
          night_moment_ids?: string[];
          venue_photo_ids?: string[];
        };
        Update: {
          account_user_id?: string;
          retired_handle?: string | null;
          profile_id?: string | null;
          deleted_at?: string;
          pint_drop_ids?: string[];
          visit_report_ids?: string[];
          community_price_ids?: string[];
          weather_recommendation_ids?: string[];
          night_memory_ids?: string[];
          night_moment_ids?: string[];
          venue_photo_ids?: string[];
        };
        Relationships: [];
      };
      adult_self_assertions: {
        Row: {
          user_id: string;
          asserted_at: string;
        };
        Insert: {
          user_id: string;
          asserted_at?: string;
        };
        Update: {
          user_id?: string;
          asserted_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "adult_self_assertions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      analytics_event_receipts: {
        Row: {
          event_id: string;
          token_hash: string;
          event_name: string;
          status: string;
          lease_until: string;
          created_at: string;
          delivered_at: string | null;
        };
        Insert: {
          event_id: string;
          token_hash: string;
          event_name: string;
          status?: string;
          lease_until: string;
          created_at?: string;
          delivered_at?: string | null;
        };
        Update: {
          event_id?: string;
          token_hash?: string;
          event_name?: string;
          status?: string;
          lease_until?: string;
          created_at?: string;
          delivered_at?: string | null;
        };
        Relationships: [];
      };
      area_demand: {
        Row: {
          id: string;
          area: string;
          area_key: string;
          matched_patch_id: string | null;
          source: string;
          email: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          area: string;
          area_key: string;
          matched_patch_id?: string | null;
          source?: string;
          email?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          area?: string;
          area_key?: string;
          matched_patch_id?: string | null;
          source?: string;
          email?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      check_ins: {
        Row: {
          id: string;
          author_id: string;
          handle: string;
          area_slug: string | null;
          venue_id: string | null;
          note: string | null;
          visibility: string;
          created_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          author_id: string;
          handle: string;
          area_slug?: string | null;
          venue_id?: string | null;
          note?: string | null;
          visibility?: string;
          created_at?: string;
          expires_at: string;
        };
        Update: {
          id?: string;
          author_id?: string;
          handle?: string;
          area_slug?: string | null;
          venue_id?: string | null;
          note?: string | null;
          visibility?: string;
          created_at?: string;
          expires_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "check_ins_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      city_enrichment_progress: {
        Row: {
          city: string;
          version: number;
          total_pubs: number;
          next_index: number;
          passes: number;
          deferred: Json;
          terminal: Json;
          lease_owner: string | null;
          lease_expires_at: string | null;
          last_run: Json | null;
          updated_at: string;
        };
        Insert: {
          city: string;
          version?: number;
          total_pubs?: number;
          next_index?: number;
          passes?: number;
          deferred?: Json;
          terminal?: Json;
          lease_owner?: string | null;
          lease_expires_at?: string | null;
          last_run?: Json | null;
          updated_at?: string;
        };
        Update: {
          city?: string;
          version?: number;
          total_pubs?: number;
          next_index?: number;
          passes?: number;
          deferred?: Json;
          terminal?: Json;
          lease_owner?: string | null;
          lease_expires_at?: string | null;
          last_run?: Json | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      community_price_reports: {
        Row: {
          id: string;
          community_price_id: string;
          actor_hash: string | null;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          community_price_id: string;
          actor_hash?: string | null;
          reason?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          community_price_id?: string;
          actor_hash?: string | null;
          reason?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "community_price_reports_community_price_id_fkey";
            columns: ["community_price_id"];
            isOneToOne: false;
            referencedRelation: "community_prices";
            referencedColumns: ["id"];
          },
        ];
      };
      community_prices: {
        Row: {
          id: string;
          venue_id: string;
          drink_category: string | null;
          price_pennies: number | null;
          actor: string | null;
          submitted_at: string;
          hidden_at: string | null;
          moderated_at: string | null;
          moderator_note: string | null;
          reported_at: string | null;
          report_reason: string | null;
          report_count: number;
          signal_key: string | null;
          signal_value: string | null;
          contributor_handle: string | null;
          corroborated_at: string | null;
          contradicted_at: string | null;
          round_spend_id: string | null;
          round_line_index: number | null;
        };
        Insert: {
          id?: string;
          venue_id: string;
          drink_category?: string | null;
          price_pennies?: number | null;
          actor?: string | null;
          submitted_at?: string;
          hidden_at?: string | null;
          moderated_at?: string | null;
          moderator_note?: string | null;
          reported_at?: string | null;
          report_reason?: string | null;
          report_count?: number;
          signal_key?: string | null;
          signal_value?: string | null;
          contributor_handle?: string | null;
          corroborated_at?: string | null;
          contradicted_at?: string | null;
          round_spend_id?: string | null;
          round_line_index?: number | null;
        };
        Update: {
          id?: string;
          venue_id?: string;
          drink_category?: string | null;
          price_pennies?: number | null;
          actor?: string | null;
          submitted_at?: string;
          hidden_at?: string | null;
          moderated_at?: string | null;
          moderator_note?: string | null;
          reported_at?: string | null;
          report_reason?: string | null;
          report_count?: number;
          signal_key?: string | null;
          signal_value?: string | null;
          contributor_handle?: string | null;
          corroborated_at?: string | null;
          contradicted_at?: string | null;
          round_spend_id?: string | null;
          round_line_index?: number | null;
        };
        Relationships: [];
      };
      conversation_members: {
        Row: {
          conversation_id: string;
          handle: string;
          role: string;
          joined_at: string;
          left_at: string | null;
        };
        Insert: {
          conversation_id: string;
          handle: string;
          role?: string;
          joined_at?: string;
          left_at?: string | null;
        };
        Update: {
          conversation_id?: string;
          handle?: string;
          role?: string;
          joined_at?: string;
          left_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          id: string;
          handle_a: string | null;
          handle_b: string | null;
          user_id_a: string | null;
          user_id_b: string | null;
          created_at: string;
          last_message_at: string;
          kind: string;
          title: string | null;
          created_by_handle: string | null;
        };
        Insert: {
          id?: string;
          handle_a?: string | null;
          handle_b?: string | null;
          user_id_a?: string | null;
          user_id_b?: string | null;
          created_at?: string;
          last_message_at?: string;
          kind?: string;
          title?: string | null;
          created_by_handle?: string | null;
        };
        Update: {
          id?: string;
          handle_a?: string | null;
          handle_b?: string | null;
          user_id_a?: string | null;
          user_id_b?: string | null;
          created_at?: string;
          last_message_at?: string;
          kind?: string;
          title?: string | null;
          created_by_handle?: string | null;
        };
        Relationships: [];
      };
      crawl_stories: {
        Row: {
          id: string;
          author_id: string | null;
          title: string;
          slug: string;
          summary: string | null;
          visibility: string;
          cover_image_url: string | null;
          created_at: string;
          updated_at: string;
          author_handle: string | null;
        };
        Insert: {
          id?: string;
          author_id?: string | null;
          title: string;
          slug: string;
          summary?: string | null;
          visibility?: string;
          cover_image_url?: string | null;
          created_at?: string;
          updated_at?: string;
          author_handle?: string | null;
        };
        Update: {
          id?: string;
          author_id?: string | null;
          title?: string;
          slug?: string;
          summary?: string | null;
          visibility?: string;
          cover_image_url?: string | null;
          created_at?: string;
          updated_at?: string;
          author_handle?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "crawl_stories_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      crawl_story_stops: {
        Row: {
          id: string;
          crawl_story_id: string;
          venue_id: string;
          position: number;
          note: string | null;
          pint_drop_id: string | null;
          arrived_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          crawl_story_id: string;
          venue_id: string;
          position?: number;
          note?: string | null;
          pint_drop_id?: string | null;
          arrived_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          crawl_story_id?: string;
          venue_id?: string;
          position?: number;
          note?: string | null;
          pint_drop_id?: string | null;
          arrived_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crawl_story_stops_crawl_story_id_fkey";
            columns: ["crawl_story_id"];
            isOneToOne: false;
            referencedRelation: "crawl_stories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crawl_story_stops_pint_drop_id_fkey";
            columns: ["pint_drop_id"];
            isOneToOne: false;
            referencedRelation: "pint_drops";
            referencedColumns: ["id"];
          },
        ];
      };
      diary_entries: {
        Row: {
          id: string;
          owner_user_id: string;
          venue_id: string;
          venue_name: string;
          visited_on: string;
          rating: number | null;
          review: string;
          visibility: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_user_id: string;
          venue_id: string;
          venue_name: string;
          visited_on: string;
          rating?: number | null;
          review?: string;
          visibility?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_user_id?: string;
          venue_id?: string;
          venue_name?: string;
          visited_on?: string;
          rating?: number | null;
          review?: string;
          visibility?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "diary_entries_owner_user_id_fkey";
            columns: ["owner_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      drink_ratings: {
        Row: {
          id: string;
          drink_ref: string;
          venue_id: string | null;
          handle: string;
          rating: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          drink_ref: string;
          venue_id?: string | null;
          handle: string;
          rating: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          drink_ref?: string;
          venue_id?: string | null;
          handle?: string;
          rating?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      drinks: {
        Row: {
          id: string;
          venue_id: string;
          category: string;
          name: string;
          producer: string | null;
          abv: number | null;
          style: string | null;
          region: string | null;
          serving_size: string | null;
          price_gbp: number;
          source: string;
          licence: string;
          observed_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          venue_id: string;
          category: string;
          name: string;
          producer?: string | null;
          abv?: number | null;
          style?: string | null;
          region?: string | null;
          serving_size?: string | null;
          price_gbp: number;
          source: string;
          licence: string;
          observed_at: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          venue_id?: string;
          category?: string;
          name?: string;
          producer?: string | null;
          abv?: number | null;
          style?: string | null;
          region?: string | null;
          serving_size?: string | null;
          price_gbp?: number;
          source?: string;
          licence?: string;
          observed_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      email_subscribers: {
        Row: {
          id: string;
          email: string;
          source: string;
          confirmed: boolean;
          unsubscribe_token: string;
          created_at: string;
          updated_at: string;
          confirmed_at: string | null;
        };
        Insert: {
          id?: string;
          email: string;
          source?: string;
          confirmed?: boolean;
          unsubscribe_token: string;
          created_at?: string;
          updated_at?: string;
          confirmed_at?: string | null;
        };
        Update: {
          id?: string;
          email?: string;
          source?: string;
          confirmed?: boolean;
          unsubscribe_token?: string;
          created_at?: string;
          updated_at?: string;
          confirmed_at?: string | null;
        };
        Relationships: [];
      };
      external_social_accounts: {
        Row: {
          id: string;
          owner_id: string;
          provider: string;
          mode: string;
          account_kind: string;
          provider_account_id: string | null;
          username: string | null;
          profile_url: string | null;
          scopes: string[];
          access_token_ciphertext: string | null;
          refresh_token_ciphertext: string | null;
          token_expires_at: string | null;
          connected_at: string;
          updated_at: string;
          refresh_status: string;
          consent_version: string;
          fetched_at: string | null;
          upstream_revocation_state: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          provider: string;
          mode: string;
          account_kind: string;
          provider_account_id?: string | null;
          username?: string | null;
          profile_url?: string | null;
          scopes?: string[];
          access_token_ciphertext?: string | null;
          refresh_token_ciphertext?: string | null;
          token_expires_at?: string | null;
          connected_at?: string;
          updated_at?: string;
          refresh_status?: string;
          consent_version?: string;
          fetched_at?: string | null;
          upstream_revocation_state?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          provider?: string;
          mode?: string;
          account_kind?: string;
          provider_account_id?: string | null;
          username?: string | null;
          profile_url?: string | null;
          scopes?: string[];
          access_token_ciphertext?: string | null;
          refresh_token_ciphertext?: string | null;
          token_expires_at?: string | null;
          connected_at?: string;
          updated_at?: string;
          refresh_status?: string;
          consent_version?: string;
          fetched_at?: string | null;
          upstream_revocation_state?: string;
        };
        Relationships: [
          {
            foreignKeyName: "external_social_accounts_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      feed_freshness: {
        Row: {
          feed: string;
          observed_at: string;
          rows_served: number | null;
          note: string | null;
          updated_at: string;
        };
        Insert: {
          feed: string;
          observed_at: string;
          rows_served?: number | null;
          note?: string | null;
          updated_at?: string;
        };
        Update: {
          feed?: string;
          observed_at?: string;
          rows_served?: number | null;
          note?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      follows: {
        Row: {
          id: string;
          follower_id: string;
          followee_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          follower_id: string;
          followee_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          follower_id?: string;
          followee_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "follows_followee_id_fkey";
            columns: ["followee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follows_follower_id_fkey";
            columns: ["follower_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      harvest_venue_overlays: {
        Row: {
          osm_id: string;
          osm_ref: string;
          website: string | null;
          menu_url: string | null;
          lore_text: string | null;
          lore_citations: Json;
          lore_match_name: string | null;
          lore_match_town: string | null;
          sources: Json;
          folded_at: string;
        };
        Insert: {
          osm_id: string;
          osm_ref: string;
          website?: string | null;
          menu_url?: string | null;
          lore_text?: string | null;
          lore_citations?: Json;
          lore_match_name?: string | null;
          lore_match_town?: string | null;
          sources?: Json;
          folded_at?: string;
        };
        Update: {
          osm_id?: string;
          osm_ref?: string;
          website?: string | null;
          menu_url?: string | null;
          lore_text?: string | null;
          lore_citations?: Json;
          lore_match_name?: string | null;
          lore_match_town?: string | null;
          sources?: Json;
          folded_at?: string;
        };
        Relationships: [];
      };
      map_search_events: {
        Row: {
          id: number;
          created_at: string;
          intent_primary: string;
          query_length: number;
          national_hit_count: number;
          national_status: string;
        };
        Insert: {
          id?: number;
          created_at?: string;
          intent_primary: string;
          query_length: number;
          national_hit_count?: number;
          national_status: string;
        };
        Update: {
          id?: number;
          created_at?: string;
          intent_primary?: string;
          query_length?: number;
          national_hit_count?: number;
          national_status?: string;
        };
        Relationships: [];
      };
      message_poll_votes: {
        Row: {
          message_id: string;
          voter_handle: string;
          option_index: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          message_id: string;
          voter_handle: string;
          option_index: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          message_id?: string;
          voter_handle?: string;
          option_index?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "message_poll_votes_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_handle: string;
          sender_user_id: string | null;
          body: string;
          created_at: string;
          read_at: string | null;
          flagged_at: string | null;
          flagged_by: string | null;
          attachment_kind: string | null;
          attachment_object_key: string | null;
          attachment_width: number | null;
          attachment_height: number | null;
          attachment_venue_id: string | null;
          client_message_id: string | null;
          sender_profile_id: string | null;
          attachment_contact_handle: string | null;
          attachment_plan_id: string | null;
          attachment_poll_question: string | null;
          attachment_poll_options: Json | null;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_handle: string;
          sender_user_id?: string | null;
          body: string;
          created_at?: string;
          read_at?: string | null;
          flagged_at?: string | null;
          flagged_by?: string | null;
          attachment_kind?: string | null;
          attachment_object_key?: string | null;
          attachment_width?: number | null;
          attachment_height?: number | null;
          attachment_venue_id?: string | null;
          client_message_id?: string | null;
          sender_profile_id?: string | null;
          attachment_contact_handle?: string | null;
          attachment_plan_id?: string | null;
          attachment_poll_question?: string | null;
          attachment_poll_options?: Json | null;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          sender_handle?: string;
          sender_user_id?: string | null;
          body?: string;
          created_at?: string;
          read_at?: string | null;
          flagged_at?: string | null;
          flagged_by?: string | null;
          attachment_kind?: string | null;
          attachment_object_key?: string | null;
          attachment_width?: number | null;
          attachment_height?: number | null;
          attachment_venue_id?: string | null;
          client_message_id?: string | null;
          sender_profile_id?: string | null;
          attachment_contact_handle?: string | null;
          attachment_plan_id?: string | null;
          attachment_poll_question?: string | null;
          attachment_poll_options?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      night_memories: {
        Row: {
          id: string;
          owner_id: string;
          title: string;
          plan_completion_id: string | null;
          visibility: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          owner_id: string;
          title: string;
          plan_completion_id?: string | null;
          visibility?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          title?: string;
          plan_completion_id?: string | null;
          visibility?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "night_memories_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "night_memories_plan_completion_id_fkey";
            columns: ["plan_completion_id"];
            isOneToOne: false;
            referencedRelation: "plan_completions";
            referencedColumns: ["id"];
          },
        ];
      };
      night_moment_consents: {
        Row: {
          story_id: string;
          moment_id: string;
          owner_id: string;
          status: string;
          decided_at: string | null;
        };
        Insert: {
          story_id: string;
          moment_id: string;
          owner_id: string;
          status?: string;
          decided_at?: string | null;
        };
        Update: {
          story_id?: string;
          moment_id?: string;
          owner_id?: string;
          status?: string;
          decided_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "night_moment_consents_moment_id_fkey";
            columns: ["moment_id"];
            isOneToOne: false;
            referencedRelation: "night_moments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "night_moment_consents_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "night_moment_consents_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "night_stories";
            referencedColumns: ["id"];
          },
        ];
      };
      night_moments: {
        Row: {
          id: string;
          memory_id: string;
          owner_id: string;
          kind: string;
          caption: string;
          pint_drop_id: string | null;
          venue_id: string | null;
          media_object_key: string | null;
          occurred_at: string | null;
          visibility: string;
          created_at: string;
          alt_text: string | null;
          alt_text_confirmed_at: string | null;
        };
        Insert: {
          id: string;
          memory_id: string;
          owner_id: string;
          kind: string;
          caption?: string;
          pint_drop_id?: string | null;
          venue_id?: string | null;
          media_object_key?: string | null;
          occurred_at?: string | null;
          visibility?: string;
          created_at?: string;
          alt_text?: string | null;
          alt_text_confirmed_at?: string | null;
        };
        Update: {
          id?: string;
          memory_id?: string;
          owner_id?: string;
          kind?: string;
          caption?: string;
          pint_drop_id?: string | null;
          venue_id?: string | null;
          media_object_key?: string | null;
          occurred_at?: string | null;
          visibility?: string;
          created_at?: string;
          alt_text?: string | null;
          alt_text_confirmed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "night_moments_memory_id_fkey";
            columns: ["memory_id"];
            isOneToOne: false;
            referencedRelation: "night_memories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "night_moments_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "night_moments_pint_drop_id_fkey";
            columns: ["pint_drop_id"];
            isOneToOne: false;
            referencedRelation: "pint_drops";
            referencedColumns: ["id"];
          },
        ];
      };
      night_profiles: {
        Row: {
          owner_id: string;
          schema_version: number;
          city_id: string;
          night_area: string | null;
          daypart: string;
          party_type: string;
          group_size: number | null;
          budget: string;
          budget_limit_pence: number | null;
          zero_proof: boolean;
          atmosphere: string[];
          food_needs: string[];
          accessibility: string[];
          transport_constraints: string[];
          briefing_preferences: Json;
          voice_preference: string;
          pub_pal_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          owner_id: string;
          schema_version?: number;
          city_id?: string;
          night_area?: string | null;
          daypart?: string;
          party_type?: string;
          group_size?: number | null;
          budget?: string;
          budget_limit_pence?: number | null;
          zero_proof?: boolean;
          atmosphere?: string[];
          food_needs?: string[];
          accessibility?: string[];
          transport_constraints?: string[];
          briefing_preferences?: Json;
          voice_preference?: string;
          pub_pal_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          owner_id?: string;
          schema_version?: number;
          city_id?: string;
          night_area?: string | null;
          daypart?: string;
          party_type?: string;
          group_size?: number | null;
          budget?: string;
          budget_limit_pence?: number | null;
          zero_proof?: boolean;
          atmosphere?: string[];
          food_needs?: string[];
          accessibility?: string[];
          transport_constraints?: string[];
          briefing_preferences?: Json;
          voice_preference?: string;
          pub_pal_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "night_profiles_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "night_profiles_pub_pal_id_fkey";
            columns: ["pub_pal_id"];
            isOneToOne: false;
            referencedRelation: "pub_pals";
            referencedColumns: ["id"];
          },
        ];
      };
      night_signal_claims: {
        Row: {
          id: string;
          kind: string;
          entity_type: string;
          entity_id: string;
          claim: string;
          source_url: string;
          publisher: string;
          published_at: string;
          observed_at: string;
          expires_at: string;
          confidence: number;
          review_state: string;
          verification: string;
          route_effect: string;
          corroborating_sources: Json;
          reviewed_at: string | null;
          review_authority: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          kind: string;
          entity_type: string;
          entity_id: string;
          claim: string;
          source_url: string;
          publisher: string;
          published_at: string;
          observed_at: string;
          expires_at: string;
          confidence: number;
          review_state: string;
          verification: string;
          route_effect: string;
          corroborating_sources?: Json;
          reviewed_at?: string | null;
          review_authority?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          kind?: string;
          entity_type?: string;
          entity_id?: string;
          claim?: string;
          source_url?: string;
          publisher?: string;
          published_at?: string;
          observed_at?: string;
          expires_at?: string;
          confidence?: number;
          review_state?: string;
          verification?: string;
          route_effect?: string;
          corroborating_sources?: Json;
          reviewed_at?: string | null;
          review_authority?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      night_signal_ingest_checkpoint: {
        Row: {
          scope: string;
          version: number;
          deferred: Json;
          terminal: Json;
          lease_owner: string | null;
          lease_expires_at: string | null;
          last_run: Json | null;
          updated_at: string;
        };
        Insert: {
          scope: string;
          version?: number;
          deferred?: Json;
          terminal?: Json;
          lease_owner?: string | null;
          lease_expires_at?: string | null;
          last_run?: Json | null;
          updated_at?: string;
        };
        Update: {
          scope?: string;
          version?: number;
          deferred?: Json;
          terminal?: Json;
          lease_owner?: string | null;
          lease_expires_at?: string | null;
          last_run?: Json | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      night_stories: {
        Row: {
          id: string;
          memory_id: string;
          host_editor_id: string;
          title: string;
          summary: string;
          status: string;
          visibility: string;
          legacy_crawl_story_id: string | null;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          memory_id: string;
          host_editor_id: string;
          title: string;
          summary?: string;
          status?: string;
          visibility?: string;
          legacy_crawl_story_id?: string | null;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          memory_id?: string;
          host_editor_id?: string;
          title?: string;
          summary?: string;
          status?: string;
          visibility?: string;
          legacy_crawl_story_id?: string | null;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "night_stories_host_editor_id_fkey";
            columns: ["host_editor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "night_stories_legacy_crawl_story_id_fkey";
            columns: ["legacy_crawl_story_id"];
            isOneToOne: false;
            referencedRelation: "crawl_stories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "night_stories_memory_id_fkey";
            columns: ["memory_id"];
            isOneToOne: false;
            referencedRelation: "night_memories";
            referencedColumns: ["id"];
          },
        ];
      };
      night_story_contributors: {
        Row: {
          story_id: string;
          profile_id: string;
          role: string;
          status: string;
          joined_at: string | null;
        };
        Insert: {
          story_id: string;
          profile_id: string;
          role: string;
          status?: string;
          joined_at?: string | null;
        };
        Update: {
          story_id?: string;
          profile_id?: string;
          role?: string;
          status?: string;
          joined_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "night_story_contributors_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "night_story_contributors_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "night_stories";
            referencedColumns: ["id"];
          },
        ];
      };
      night_story_moments: {
        Row: {
          story_id: string;
          moment_id: string;
          position: number;
        };
        Insert: {
          story_id: string;
          moment_id: string;
          position: number;
        };
        Update: {
          story_id?: string;
          moment_id?: string;
          position?: number;
        };
        Relationships: [
          {
            foreignKeyName: "night_story_moments_moment_id_fkey";
            columns: ["moment_id"];
            isOneToOne: false;
            referencedRelation: "night_moments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "night_story_moments_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "night_stories";
            referencedColumns: ["id"];
          },
        ];
      };
      night_story_publish_proposals: {
        Row: {
          id: string;
          story_id: string;
          requested_by: string;
          moment_ids: string[];
          visibility: string;
          token_hash: string;
          expires_at: string;
          confirmed_at: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          story_id: string;
          requested_by: string;
          moment_ids: string[];
          visibility: string;
          token_hash: string;
          expires_at: string;
          confirmed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          story_id?: string;
          requested_by?: string;
          moment_ids?: string[];
          visibility?: string;
          token_hash?: string;
          expires_at?: string;
          confirmed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "night_story_publish_proposals_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "night_story_publish_proposals_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "night_stories";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          id: string;
          recipient_handle: string;
          actor_handle: string;
          kind: string;
          subject_ref: string | null;
          subject_label: string | null;
          created_at: string;
          read_at: string | null;
        };
        Insert: {
          id?: string;
          recipient_handle: string;
          actor_handle: string;
          kind: string;
          subject_ref?: string | null;
          subject_label?: string | null;
          created_at?: string;
          read_at?: string | null;
        };
        Update: {
          id?: string;
          recipient_handle?: string;
          actor_handle?: string;
          kind?: string;
          subject_ref?: string | null;
          subject_label?: string | null;
          created_at?: string;
          read_at?: string | null;
        };
        Relationships: [];
      };
      operator_proposals: {
        Row: {
          id: string;
          venue_id: string;
          account_id: string;
          type: string;
          payload: Json;
          status: string;
          reviewed_at: string | null;
          reviewer_note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          venue_id: string;
          account_id: string;
          type: string;
          payload?: Json;
          status?: string;
          reviewed_at?: string | null;
          reviewer_note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          venue_id?: string;
          account_id?: string;
          type?: string;
          payload?: Json;
          status?: string;
          reviewed_at?: string | null;
          reviewer_note?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      pending_plan_recaps: {
        Row: {
          owner_id: string;
          completion_id: string;
          plan_id: string;
          draft: Json;
          saved_at: string;
          created_at: string;
        };
        Insert: {
          owner_id: string;
          completion_id: string;
          plan_id: string;
          draft: Json;
          saved_at: string;
          created_at?: string;
        };
        Update: {
          owner_id?: string;
          completion_id?: string;
          plan_id?: string;
          draft?: Json;
          saved_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      pint_drop_comments: {
        Row: {
          id: string;
          pint_drop_id: string;
          actor_hash: string;
          handle: string | null;
          body: string;
          status: string;
          created_at: string;
          updated_at: string;
          parent_id: string | null;
        };
        Insert: {
          id?: string;
          pint_drop_id: string;
          actor_hash: string;
          handle?: string | null;
          body: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
          parent_id?: string | null;
        };
        Update: {
          id?: string;
          pint_drop_id?: string;
          actor_hash?: string;
          handle?: string | null;
          body?: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
          parent_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "pint_drop_comments_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "pint_drop_comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pint_drop_comments_pint_drop_id_fkey";
            columns: ["pint_drop_id"];
            isOneToOne: false;
            referencedRelation: "pint_drops";
            referencedColumns: ["id"];
          },
        ];
      };
      pint_drop_reactions: {
        Row: {
          id: string;
          pint_drop_id: string;
          actor_hash: string;
          reaction: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          pint_drop_id: string;
          actor_hash: string;
          reaction: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          pint_drop_id?: string;
          actor_hash?: string;
          reaction?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pint_drop_reactions_pint_drop_id_fkey";
            columns: ["pint_drop_id"];
            isOneToOne: false;
            referencedRelation: "pint_drops";
            referencedColumns: ["id"];
          },
        ];
      };
      pint_drop_reports: {
        Row: {
          id: string;
          pint_drop_id: string;
          actor_hash: string;
          reason: string | null;
          details: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          pint_drop_id: string;
          actor_hash: string;
          reason?: string | null;
          details?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          pint_drop_id?: string;
          actor_hash?: string;
          reason?: string | null;
          details?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pint_drop_reports_pint_drop_id_fkey";
            columns: ["pint_drop_id"];
            isOneToOne: false;
            referencedRelation: "pint_drops";
            referencedColumns: ["id"];
          },
        ];
      };
      pint_drop_verified_reports: {
        Row: {
          id: string;
          pint_drop_id: string;
          actor_hash: string;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          pint_drop_id: string;
          actor_hash: string;
          reason?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          pint_drop_id?: string;
          actor_hash?: string;
          reason?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pint_drop_verified_reports_pint_drop_id_fkey";
            columns: ["pint_drop_id"];
            isOneToOne: false;
            referencedRelation: "pint_drops";
            referencedColumns: ["id"];
          },
        ];
      };
      pint_drops: {
        Row: {
          id: string;
          venue_id: string;
          handle: string;
          drink: string | null;
          price_gbp: number | null;
          passed_down_note: string | null;
          era: string | null;
          pint_photo_key: string | null;
          provenance: string | null;
          status: string;
          created_at: string;
          venue_photo_key: string | null;
          reported_at: string | null;
          report_reason: string | null;
          report_count: number;
          moderated_at: string | null;
          moderator_note: string | null;
          vibe_tags: string[];
          visibility: string;
          leave_by_iso: string | null;
          last_train_decision: string | null;
          verified_report_count: number;
          authority_key: string | null;
          confirmation_id: string | null;
          confirmed_at: string | null;
          confirmation_basis: string | null;
          confirming_drop_id: string | null;
          price_day: string | null;
          measure: string;
          measure_label: string | null;
          author_retired_at: string | null;
          receipt_photo_key: string | null;
        };
        Insert: {
          id?: string;
          venue_id: string;
          handle: string;
          drink?: string | null;
          price_gbp?: number | null;
          passed_down_note?: string | null;
          era?: string | null;
          pint_photo_key?: string | null;
          provenance?: string | null;
          status?: string;
          created_at?: string;
          venue_photo_key?: string | null;
          reported_at?: string | null;
          report_reason?: string | null;
          report_count?: number;
          moderated_at?: string | null;
          moderator_note?: string | null;
          vibe_tags?: string[];
          visibility?: string;
          leave_by_iso?: string | null;
          last_train_decision?: string | null;
          verified_report_count?: number;
          authority_key?: string | null;
          confirmation_id?: string | null;
          confirmed_at?: string | null;
          confirmation_basis?: string | null;
          confirming_drop_id?: string | null;
          price_day?: string | null;
          measure?: string;
          measure_label?: string | null;
          author_retired_at?: string | null;
          receipt_photo_key?: string | null;
        };
        Update: {
          id?: string;
          venue_id?: string;
          handle?: string;
          drink?: string | null;
          price_gbp?: number | null;
          passed_down_note?: string | null;
          era?: string | null;
          pint_photo_key?: string | null;
          provenance?: string | null;
          status?: string;
          created_at?: string;
          venue_photo_key?: string | null;
          reported_at?: string | null;
          report_reason?: string | null;
          report_count?: number;
          moderated_at?: string | null;
          moderator_note?: string | null;
          vibe_tags?: string[];
          visibility?: string;
          leave_by_iso?: string | null;
          last_train_decision?: string | null;
          verified_report_count?: number;
          authority_key?: string | null;
          confirmation_id?: string | null;
          confirmed_at?: string | null;
          confirmation_basis?: string | null;
          confirming_drop_id?: string | null;
          price_day?: string | null;
          measure?: string;
          measure_label?: string | null;
          author_retired_at?: string | null;
          receipt_photo_key?: string | null;
        };
        Relationships: [];
      };
      plan_actions: {
        Row: {
          id: string;
          plan_id: string;
          actor_member_id: string | null;
          type: string;
          stop_position: number | null;
          ending: string | null;
          created_at: string;
          idempotency_key_hash: string | null;
          request_hash: string | null;
        };
        Insert: {
          id: string;
          plan_id: string;
          actor_member_id?: string | null;
          type: string;
          stop_position?: number | null;
          ending?: string | null;
          created_at?: string;
          idempotency_key_hash?: string | null;
          request_hash?: string | null;
        };
        Update: {
          id?: string;
          plan_id?: string;
          actor_member_id?: string | null;
          type?: string;
          stop_position?: number | null;
          ending?: string | null;
          created_at?: string;
          idempotency_key_hash?: string | null;
          request_hash?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "plan_actions_actor_member_id_fkey";
            columns: ["actor_member_id"];
            isOneToOne: false;
            referencedRelation: "plan_crew_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_actions_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_completions: {
        Row: {
          id: string;
          plan_id: string;
          ending: string;
          terminal_venue_id: string | null;
          final_pint_drop_id: string | null;
          actor_member_id: string;
          completed_at: string;
          route_revision: number;
          route_snapshot: Json;
          ending_selection: Json | null;
          qualifying_arrival_action_id: string | null;
          qualifying_arrival_stop_position: number | null;
          qualifying_arrival_at: string | null;
        };
        Insert: {
          id: string;
          plan_id: string;
          ending: string;
          terminal_venue_id?: string | null;
          final_pint_drop_id?: string | null;
          actor_member_id: string;
          completed_at?: string;
          route_revision: number;
          route_snapshot: Json;
          ending_selection?: Json | null;
          qualifying_arrival_action_id?: string | null;
          qualifying_arrival_stop_position?: number | null;
          qualifying_arrival_at?: string | null;
        };
        Update: {
          id?: string;
          plan_id?: string;
          ending?: string;
          terminal_venue_id?: string | null;
          final_pint_drop_id?: string | null;
          actor_member_id?: string;
          completed_at?: string;
          route_revision?: number;
          route_snapshot?: Json;
          ending_selection?: Json | null;
          qualifying_arrival_action_id?: string | null;
          qualifying_arrival_stop_position?: number | null;
          qualifying_arrival_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "plan_completions_final_pint_drop_id_fkey";
            columns: ["final_pint_drop_id"];
            isOneToOne: false;
            referencedRelation: "pint_drops";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_completions_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: true;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_completions_qualifying_arrival_action_fk";
            columns: ["qualifying_arrival_action_id"];
            isOneToOne: false;
            referencedRelation: "plan_actions";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_constraints: {
        Row: {
          id: string;
          plan_id: string;
          member_id: string;
          kind: string;
          value: string;
          priority: string;
          idempotency_key: string;
          created_at: string;
          resolved_at: string | null;
          resolved_by_member_id: string | null;
          resolution_evidence: Json | null;
          resolution_idempotency_key: string | null;
        };
        Insert: {
          id: string;
          plan_id: string;
          member_id: string;
          kind: string;
          value: string;
          priority: string;
          idempotency_key: string;
          created_at: string;
          resolved_at?: string | null;
          resolved_by_member_id?: string | null;
          resolution_evidence?: Json | null;
          resolution_idempotency_key?: string | null;
        };
        Update: {
          id?: string;
          plan_id?: string;
          member_id?: string;
          kind?: string;
          value?: string;
          priority?: string;
          idempotency_key?: string;
          created_at?: string;
          resolved_at?: string | null;
          resolved_by_member_id?: string | null;
          resolution_evidence?: Json | null;
          resolution_idempotency_key?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "plan_constraints_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "plan_crew_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_constraints_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_constraints_resolved_by_member_id_fkey";
            columns: ["resolved_by_member_id"];
            isOneToOne: false;
            referencedRelation: "plan_crew_members";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_crew_members: {
        Row: {
          id: string;
          plan_id: string;
          name: string;
          status: string;
          token_hash: string;
          user_id: string | null;
          joined_at: string;
          updated_at: string;
          can_collaborate: boolean;
          join_key_hash: string | null;
          join_request_hash: string | null;
          social_account_id: string | null;
          membership_revoked_at: string | null;
          recovery_key_hash: string | null;
          recovery_request_hash: string | null;
        };
        Insert: {
          id?: string;
          plan_id: string;
          name: string;
          status?: string;
          token_hash: string;
          user_id?: string | null;
          joined_at?: string;
          updated_at?: string;
          can_collaborate?: boolean;
          join_key_hash?: string | null;
          join_request_hash?: string | null;
          social_account_id?: string | null;
          membership_revoked_at?: string | null;
          recovery_key_hash?: string | null;
          recovery_request_hash?: string | null;
        };
        Update: {
          id?: string;
          plan_id?: string;
          name?: string;
          status?: string;
          token_hash?: string;
          user_id?: string | null;
          joined_at?: string;
          updated_at?: string;
          can_collaborate?: boolean;
          join_key_hash?: string | null;
          join_request_hash?: string | null;
          social_account_id?: string | null;
          membership_revoked_at?: string | null;
          recovery_key_hash?: string | null;
          recovery_request_hash?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "plan_crew_members_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_crew_members_social_account_id_fkey";
            columns: ["social_account_id"];
            isOneToOne: false;
            referencedRelation: "private_social_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_crew_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_invite_reactions: {
        Row: {
          id: string;
          plan_id: string;
          submitter_hash: string;
          reaction: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          plan_id: string;
          submitter_hash: string;
          reaction: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          plan_id?: string;
          submitter_hash?: string;
          reaction?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "plan_invite_reactions_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_invite_rsvps: {
        Row: {
          id: string;
          plan_id: string;
          submitter_hash: string;
          display_name: string;
          status: string;
          created_at: string;
          updated_at: string;
          member_id: string | null;
        };
        Insert: {
          id?: string;
          plan_id: string;
          submitter_hash: string;
          display_name: string;
          status: string;
          created_at?: string;
          updated_at?: string;
          member_id?: string | null;
        };
        Update: {
          id?: string;
          plan_id?: string;
          submitter_hash?: string;
          display_name?: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
          member_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "plan_invite_rsvps_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "plan_crew_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_invite_rsvps_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_invites: {
        Row: {
          id: string;
          plan_id: string;
          created_by_member_id: string;
          role: string;
          token_hash: string;
          idempotency_key: string;
          created_at: string;
          expires_at: string;
          revoked_at: string | null;
          redeemed_at: string | null;
        };
        Insert: {
          id: string;
          plan_id: string;
          created_by_member_id: string;
          role?: string;
          token_hash: string;
          idempotency_key: string;
          created_at: string;
          expires_at: string;
          revoked_at?: string | null;
          redeemed_at?: string | null;
        };
        Update: {
          id?: string;
          plan_id?: string;
          created_by_member_id?: string;
          role?: string;
          token_hash?: string;
          idempotency_key?: string;
          created_at?: string;
          expires_at?: string;
          revoked_at?: string | null;
          redeemed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "plan_invites_created_by_member_id_fkey";
            columns: ["created_by_member_id"];
            isOneToOne: false;
            referencedRelation: "plan_crew_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_invites_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_member_group_pref_requests: {
        Row: {
          plan_id: string;
          member_id: string;
          idempotency_key: string;
          budget_band: string;
          atmosphere_chip: string;
          zero_proof: boolean;
          accessibility_required: boolean;
          weather_shelter_required: boolean;
          created_at: string;
        };
        Insert: {
          plan_id: string;
          member_id: string;
          idempotency_key: string;
          budget_band: string;
          atmosphere_chip: string;
          zero_proof: boolean;
          accessibility_required: boolean;
          weather_shelter_required: boolean;
          created_at: string;
        };
        Update: {
          plan_id?: string;
          member_id?: string;
          idempotency_key?: string;
          budget_band?: string;
          atmosphere_chip?: string;
          zero_proof?: boolean;
          accessibility_required?: boolean;
          weather_shelter_required?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "plan_member_group_pref_requests_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "plan_crew_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_member_group_pref_requests_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_member_group_prefs: {
        Row: {
          id: string;
          plan_id: string;
          member_id: string;
          budget_band: string;
          atmosphere_chip: string;
          zero_proof: boolean;
          accessibility_required: boolean;
          weather_shelter_required: boolean;
          idempotency_key: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          plan_id: string;
          member_id: string;
          budget_band: string;
          atmosphere_chip: string;
          zero_proof?: boolean;
          accessibility_required?: boolean;
          weather_shelter_required?: boolean;
          idempotency_key: string;
          created_at: string;
          updated_at: string;
        };
        Update: {
          id?: string;
          plan_id?: string;
          member_id?: string;
          budget_band?: string;
          atmosphere_chip?: string;
          zero_proof?: boolean;
          accessibility_required?: boolean;
          weather_shelter_required?: boolean;
          idempotency_key?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "plan_member_group_prefs_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "plan_crew_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_member_group_prefs_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_route_proposals: {
        Row: {
          id: string;
          plan_id: string;
          proposed_by_member_id: string;
          expected_route_revision: number;
          stops: Json;
          reason: string;
          resolved_constraint_ids: Json;
          unresolved_constraint_ids: Json;
          status: string;
          idempotency_key: string;
          decision_idempotency_key: string | null;
          created_at: string;
          decided_at: string | null;
        };
        Insert: {
          id: string;
          plan_id: string;
          proposed_by_member_id: string;
          expected_route_revision: number;
          stops: Json;
          reason: string;
          resolved_constraint_ids?: Json;
          unresolved_constraint_ids?: Json;
          status?: string;
          idempotency_key: string;
          decision_idempotency_key?: string | null;
          created_at: string;
          decided_at?: string | null;
        };
        Update: {
          id?: string;
          plan_id?: string;
          proposed_by_member_id?: string;
          expected_route_revision?: number;
          stops?: Json;
          reason?: string;
          resolved_constraint_ids?: Json;
          unresolved_constraint_ids?: Json;
          status?: string;
          idempotency_key?: string;
          decision_idempotency_key?: string | null;
          created_at?: string;
          decided_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "plan_route_proposals_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_route_proposals_proposed_by_member_id_fkey";
            columns: ["proposed_by_member_id"];
            isOneToOne: false;
            referencedRelation: "plan_crew_members";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_stops: {
        Row: {
          id: number;
          plan_id: string;
          venue_id: string;
          venue_name: string;
          position: number;
          selected_drink_price_evidence: Json | null;
        };
        Insert: {
          id?: number;
          plan_id: string;
          venue_id: string;
          venue_name: string;
          position: number;
          selected_drink_price_evidence?: Json | null;
        };
        Update: {
          id?: number;
          plan_id?: string;
          venue_id?: string;
          venue_name?: string;
          position?: number;
          selected_drink_price_evidence?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "plan_stops_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_vibe_vote_requests: {
        Row: {
          plan_id: string;
          member_id: string;
          idempotency_key: string;
          vibe: string;
          created_at: string;
        };
        Insert: {
          plan_id: string;
          member_id: string;
          idempotency_key: string;
          vibe: string;
          created_at: string;
        };
        Update: {
          plan_id?: string;
          member_id?: string;
          idempotency_key?: string;
          vibe?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "plan_vibe_vote_requests_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "plan_crew_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_vibe_vote_requests_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_vibe_votes: {
        Row: {
          id: string;
          plan_id: string;
          member_id: string;
          vibe: string;
          idempotency_key: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          plan_id: string;
          member_id: string;
          vibe: string;
          idempotency_key: string;
          created_at: string;
          updated_at: string;
        };
        Update: {
          id?: string;
          plan_id?: string;
          member_id?: string;
          vibe?: string;
          idempotency_key?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "plan_vibe_votes_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "plan_crew_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_vibe_votes_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_vote_requests: {
        Row: {
          plan_id: string;
          member_id: string;
          idempotency_key: string;
          vote_id: string;
          value: string;
          created_at: string;
        };
        Insert: {
          plan_id: string;
          member_id: string;
          idempotency_key: string;
          vote_id: string;
          value: string;
          created_at: string;
        };
        Update: {
          plan_id?: string;
          member_id?: string;
          idempotency_key?: string;
          vote_id?: string;
          value?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "plan_vote_requests_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "plan_crew_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_vote_requests_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_vote_requests_vote_id_fkey";
            columns: ["vote_id"];
            isOneToOne: false;
            referencedRelation: "plan_votes";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_votes: {
        Row: {
          id: string;
          plan_id: string;
          proposal_id: string;
          member_id: string;
          value: string;
          idempotency_key: string;
          created_at: string;
        };
        Insert: {
          id: string;
          plan_id: string;
          proposal_id: string;
          member_id: string;
          value: string;
          idempotency_key: string;
          created_at: string;
        };
        Update: {
          id?: string;
          plan_id?: string;
          proposal_id?: string;
          member_id?: string;
          value?: string;
          idempotency_key?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "plan_votes_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "plan_crew_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_votes_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_votes_proposal_id_fkey";
            columns: ["proposal_id"];
            isOneToOne: false;
            referencedRelation: "plan_route_proposals";
            referencedColumns: ["id"];
          },
        ];
      };
      plans: {
        Row: {
          id: string;
          title: string;
          start_time: string;
          owner_user_id: string | null;
          created_at: string;
          status: string;
          night_context: Json | null;
          ending: string | null;
          route_revision: number;
          creation_key_hash: string | null;
          creation_request_hash: string | null;
          anchor_venue_id: string | null;
          anchor_source: string | null;
          plan_outcome: string | null;
          route_ready_at: string | null;
          social_owner_account_id: string | null;
          invite_token: string;
        };
        Insert: {
          id?: string;
          title: string;
          start_time: string;
          owner_user_id?: string | null;
          created_at?: string;
          status?: string;
          night_context?: Json | null;
          ending?: string | null;
          route_revision?: number;
          creation_key_hash?: string | null;
          creation_request_hash?: string | null;
          anchor_venue_id?: string | null;
          anchor_source?: string | null;
          plan_outcome?: string | null;
          route_ready_at?: string | null;
          social_owner_account_id?: string | null;
          invite_token?: string;
        };
        Update: {
          id?: string;
          title?: string;
          start_time?: string;
          owner_user_id?: string | null;
          created_at?: string;
          status?: string;
          night_context?: Json | null;
          ending?: string | null;
          route_revision?: number;
          creation_key_hash?: string | null;
          creation_request_hash?: string | null;
          anchor_venue_id?: string | null;
          anchor_source?: string | null;
          plan_outcome?: string | null;
          route_ready_at?: string | null;
          social_owner_account_id?: string | null;
          invite_token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "plans_owner_user_id_fkey";
            columns: ["owner_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plans_social_owner_account_id_fkey";
            columns: ["social_owner_account_id"];
            isOneToOne: false;
            referencedRelation: "private_social_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      price_confirms: {
        Row: {
          id: string;
          venue_id: string;
          price_pennies: number;
          actor: string;
          last_confirmed_at: string;
        };
        Insert: {
          id?: string;
          venue_id: string;
          price_pennies: number;
          actor: string;
          last_confirmed_at?: string;
        };
        Update: {
          id?: string;
          venue_id?: string;
          price_pennies?: number;
          actor?: string;
          last_confirmed_at?: string;
        };
        Relationships: [];
      };
      price_trust_credits: {
        Row: {
          user_id: string;
          trust_event_id: string;
        };
        Insert: {
          user_id: string;
          trust_event_id: string;
        };
        Update: {
          user_id?: string;
          trust_event_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "price_trust_credits_trust_event_id_fkey";
            columns: ["trust_event_id"];
            isOneToOne: false;
            referencedRelation: "price_trust_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "price_trust_credits_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      price_trust_events: {
        Row: {
          id: string;
          evidence_fingerprint: string;
          venue_id: string;
          category: string;
          observation_ids: string[];
          created_at: string;
          reversal_of: string | null;
        };
        Insert: {
          id: string;
          evidence_fingerprint: string;
          venue_id: string;
          category: string;
          observation_ids: string[];
          created_at?: string;
          reversal_of?: string | null;
        };
        Update: {
          id?: string;
          evidence_fingerprint?: string;
          venue_id?: string;
          category?: string;
          observation_ids?: string[];
          created_at?: string;
          reversal_of?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "price_trust_events_reversal_of_fkey";
            columns: ["reversal_of"];
            isOneToOne: false;
            referencedRelation: "price_trust_events";
            referencedColumns: ["id"];
          },
        ];
      };
      price_trust_reconciliation_queue: {
        Row: {
          venue_id: string;
          category: string;
          version: number;
          enqueued_at: string;
        };
        Insert: {
          venue_id: string;
          category: string;
          version?: number;
          enqueued_at?: string;
        };
        Update: {
          venue_id?: string;
          category?: string;
          version?: number;
          enqueued_at?: string;
        };
        Relationships: [];
      };
      private_account_identities: {
        Row: {
          user_id: string;
          date_of_birth: string;
          full_name: string | null;
          sex: string | null;
          created_at: string;
          updated_at: string;
          gender: string | null;
          gender_self_described: string | null;
        };
        Insert: {
          user_id: string;
          date_of_birth: string;
          full_name?: string | null;
          sex?: string | null;
          created_at?: string;
          updated_at?: string;
          gender?: string | null;
          gender_self_described?: string | null;
        };
        Update: {
          user_id?: string;
          date_of_birth?: string;
          full_name?: string | null;
          sex?: string | null;
          created_at?: string;
          updated_at?: string;
          gender?: string | null;
          gender_self_described?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "private_account_identities_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      private_social_account_audit: {
        Row: {
          id: number;
          product_account_id: string;
          action: string;
          previous_supabase_user_id: string | null;
          current_supabase_user_id: string | null;
          changed_at: string;
        };
        Insert: {
          id?: number;
          product_account_id: string;
          action: string;
          previous_supabase_user_id?: string | null;
          current_supabase_user_id?: string | null;
          changed_at?: string;
        };
        Update: {
          id?: number;
          product_account_id?: string;
          action?: string;
          previous_supabase_user_id?: string | null;
          current_supabase_user_id?: string | null;
          changed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "private_social_account_audit_product_account_id_fkey";
            columns: ["product_account_id"];
            isOneToOne: false;
            referencedRelation: "private_social_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      private_social_accounts: {
        Row: {
          id: string;
          clerk_user_id: string;
          supabase_user_id: string | null;
          profile_id: string;
          ownership_state: string;
          ownership_changed_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          clerk_user_id: string;
          supabase_user_id?: string | null;
          profile_id: string;
          ownership_state?: string;
          ownership_changed_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          clerk_user_id?: string;
          supabase_user_id?: string | null;
          profile_id?: string;
          ownership_state?: string;
          ownership_changed_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "private_social_accounts_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "private_social_accounts_supabase_user_id_fkey";
            columns: ["supabase_user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      private_social_age_verifications: {
        Row: {
          id: string;
          product_account_id: string;
          provider: string;
          yoti_subject_reference: string;
          decision: string;
          verified_at: string;
          expires_at: string;
          audit_state: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_account_id: string;
          provider: string;
          yoti_subject_reference: string;
          decision: string;
          verified_at: string;
          expires_at: string;
          audit_state: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          product_account_id?: string;
          provider?: string;
          yoti_subject_reference?: string;
          decision?: string;
          verified_at?: string;
          expires_at?: string;
          audit_state?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "private_social_age_verifications_product_account_id_fkey";
            columns: ["product_account_id"];
            isOneToOne: false;
            referencedRelation: "private_social_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      private_social_crew_write_receipts: {
        Row: {
          actor_account_id: string;
          operation: string;
          idempotency_key: string;
          payload_digest: string;
          response: Json;
          created_at: string;
        };
        Insert: {
          actor_account_id: string;
          operation: string;
          idempotency_key: string;
          payload_digest: string;
          response: Json;
          created_at?: string;
        };
        Update: {
          actor_account_id?: string;
          operation?: string;
          idempotency_key?: string;
          payload_digest?: string;
          response?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "private_social_crew_write_receipts_actor_account_id_fkey";
            columns: ["actor_account_id"];
            isOneToOne: false;
            referencedRelation: "private_social_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      private_social_staff_roles: {
        Row: {
          id: string;
          profile_id: string;
          display_name: string;
          role: string;
          active: boolean;
          created_at: string;
          revoked_at: string | null;
        };
        Insert: {
          id?: string;
          profile_id: string;
          display_name: string;
          role: string;
          active?: boolean;
          created_at?: string;
          revoked_at?: string | null;
        };
        Update: {
          id?: string;
          profile_id?: string;
          display_name?: string;
          role?: string;
          active?: boolean;
          created_at?: string;
          revoked_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "private_social_staff_roles_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profile_cover_photos: {
        Row: {
          id: string;
          profile_id: string;
          position: number;
          generation: string;
          object_key: string;
          moderation_state: string;
          report_count: number;
          report_actors: string[];
          reported_at: string | null;
          report_reason: string | null;
          moderated_at: string | null;
          moderator_note: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          profile_id: string;
          position: number;
          generation: string;
          object_key: string;
          moderation_state?: string;
          report_count?: number;
          report_actors?: string[];
          reported_at?: string | null;
          report_reason?: string | null;
          moderated_at?: string | null;
          moderator_note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string;
          position?: number;
          generation?: string;
          object_key?: string;
          moderation_state?: string;
          report_count?: number;
          report_actors?: string[];
          reported_at?: string | null;
          report_reason?: string | null;
          moderated_at?: string | null;
          moderator_note?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profile_cover_photos_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profile_handle_aliases: {
        Row: {
          id: string;
          profile_id: string;
          handle: string;
          is_current: boolean;
          claimed_at: string;
          retired_at: string | null;
        };
        Insert: {
          id?: string;
          profile_id: string;
          handle: string;
          is_current?: boolean;
          claimed_at?: string;
          retired_at?: string | null;
        };
        Update: {
          id?: string;
          profile_id?: string;
          handle?: string;
          is_current?: boolean;
          claimed_at?: string;
          retired_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profile_handle_aliases_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          user_id: string | null;
          handle: string;
          display_name: string | null;
          avatar_url: string | null;
          home_city: string | null;
          bio: string | null;
          created_at: string;
          updated_at: string;
          handle_changed_at: string | null;
          tombstoned_at: string | null;
          avatar_object_key: string | null;
          avatar_generation: string | null;
          avatar_moderation_state: string | null;
          avatar_report_count: number;
          avatar_reported_at: string | null;
          avatar_report_reason: string | null;
          avatar_report_actors: string[];
          avatar_moderated_at: string | null;
          avatar_moderator_note: string | null;
          cover_object_key: string | null;
          cover_generation: string | null;
          cover_moderation_state: string | null;
          cover_report_count: number;
          cover_reported_at: string | null;
          cover_report_reason: string | null;
          cover_report_actors: string[];
          cover_moderated_at: string | null;
          cover_moderator_note: string | null;
          favourite_drink: string | null;
          interests: string | null;
          workplace: string | null;
          founding_member_number: number | null;
          visibility: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          handle: string;
          display_name?: string | null;
          avatar_url?: string | null;
          home_city?: string | null;
          bio?: string | null;
          created_at?: string;
          updated_at?: string;
          handle_changed_at?: string | null;
          tombstoned_at?: string | null;
          avatar_object_key?: string | null;
          avatar_generation?: string | null;
          avatar_moderation_state?: string | null;
          avatar_report_count?: number;
          avatar_reported_at?: string | null;
          avatar_report_reason?: string | null;
          avatar_report_actors?: string[];
          avatar_moderated_at?: string | null;
          avatar_moderator_note?: string | null;
          cover_object_key?: string | null;
          cover_generation?: string | null;
          cover_moderation_state?: string | null;
          cover_report_count?: number;
          cover_reported_at?: string | null;
          cover_report_reason?: string | null;
          cover_report_actors?: string[];
          cover_moderated_at?: string | null;
          cover_moderator_note?: string | null;
          favourite_drink?: string | null;
          interests?: string | null;
          workplace?: string | null;
          founding_member_number?: number | null;
          visibility?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          handle?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          home_city?: string | null;
          bio?: string | null;
          created_at?: string;
          updated_at?: string;
          handle_changed_at?: string | null;
          tombstoned_at?: string | null;
          avatar_object_key?: string | null;
          avatar_generation?: string | null;
          avatar_moderation_state?: string | null;
          avatar_report_count?: number;
          avatar_reported_at?: string | null;
          avatar_report_reason?: string | null;
          avatar_report_actors?: string[];
          avatar_moderated_at?: string | null;
          avatar_moderator_note?: string | null;
          cover_object_key?: string | null;
          cover_generation?: string | null;
          cover_moderation_state?: string | null;
          cover_report_count?: number;
          cover_reported_at?: string | null;
          cover_report_reason?: string | null;
          cover_report_actors?: string[];
          cover_moderated_at?: string | null;
          cover_moderator_note?: string | null;
          favourite_drink?: string | null;
          interests?: string | null;
          workplace?: string | null;
          founding_member_number?: number | null;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_user_fk";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      pub_heritage: {
        Row: {
          id: number;
          venue_key: string | null;
          source: string;
          fact: string;
          source_ref: string | null;
          retrieved_at: string | null;
        };
        Insert: {
          id?: number;
          venue_key?: string | null;
          source: string;
          fact: string;
          source_ref?: string | null;
          retrieved_at?: string | null;
        };
        Update: {
          id?: number;
          venue_key?: string | null;
          source?: string;
          fact?: string;
          source_ref?: string | null;
          retrieved_at?: string | null;
        };
        Relationships: [];
      };
      pub_pal_mastery_events: {
        Row: {
          id: string;
          pal_id: string;
          kind: string;
          source_id: string;
          points: number;
          created_at: string;
        };
        Insert: {
          id: string;
          pal_id: string;
          kind: string;
          source_id: string;
          points: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          pal_id?: string;
          kind?: string;
          source_id?: string;
          points?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pub_pal_mastery_events_pal_id_fkey";
            columns: ["pal_id"];
            isOneToOne: false;
            referencedRelation: "pub_pals";
            referencedColumns: ["id"];
          },
        ];
      };
      pub_pal_memories: {
        Row: {
          id: string;
          pal_id: string;
          kind: string;
          value: string;
          provenance: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          pal_id: string;
          kind: string;
          value: string;
          provenance: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          pal_id?: string;
          kind?: string;
          value?: string;
          provenance?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pub_pal_memories_pal_id_fkey";
            columns: ["pal_id"];
            isOneToOne: false;
            referencedRelation: "pub_pals";
            referencedColumns: ["id"];
          },
        ];
      };
      pub_pal_tool_turns: {
        Row: {
          conversation_id: string;
          payload: Json;
          expires_at: string;
          created_at: string;
          owner_id: string | null;
        };
        Insert: {
          conversation_id: string;
          payload: Json;
          expires_at: string;
          created_at?: string;
          owner_id?: string | null;
        };
        Update: {
          conversation_id?: string;
          payload?: Json;
          expires_at?: string;
          created_at?: string;
          owner_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "pub_pal_tool_turns_owner_fk";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      pub_pal_voice_usage: {
        Row: {
          owner_id: string;
          usage_month: string;
          session_count: number;
          used_minutes: number;
        };
        Insert: {
          owner_id: string;
          usage_month: string;
          session_count?: number;
          used_minutes?: number;
        };
        Update: {
          owner_id?: string;
          usage_month?: string;
          session_count?: number;
          used_minutes?: number;
        };
        Relationships: [
          {
            foreignKeyName: "pub_pal_voice_usage_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      pub_pals: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          adult_attested_at: string;
          appearance: Json;
          personality: Json;
          voice: Json;
          muted: boolean;
          hidden: boolean;
          mastery_points: number;
          created_at: string;
          updated_at: string;
          proposal_preferences: Json;
        };
        Insert: {
          id: string;
          owner_id: string;
          name: string;
          adult_attested_at: string;
          appearance: Json;
          personality: Json;
          voice: Json;
          muted?: boolean;
          hidden?: boolean;
          mastery_points?: number;
          created_at?: string;
          updated_at?: string;
          proposal_preferences?: Json;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name?: string;
          adult_attested_at?: string;
          appearance?: Json;
          personality?: Json;
          voice?: Json;
          muted?: boolean;
          hidden?: boolean;
          mastery_points?: number;
          created_at?: string;
          updated_at?: string;
          proposal_preferences?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "pub_pals_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      pub_presence: {
        Row: {
          id: string;
          handle: string;
          venue_id: string;
          actor_hash: string;
          created_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          handle: string;
          venue_id: string;
          actor_hash: string;
          created_at?: string;
          expires_at?: string;
        };
        Update: {
          id?: string;
          handle?: string;
          venue_id?: string;
          actor_hash?: string;
          created_at?: string;
          expires_at?: string;
        };
        Relationships: [];
      };
      push_tokens: {
        Row: {
          token: string;
          platform: string;
          created_at: string;
          last_seen_at: string;
        };
        Insert: {
          token: string;
          platform: string;
          created_at?: string;
          last_seen_at?: string;
        };
        Update: {
          token?: string;
          platform?: string;
          created_at?: string;
          last_seen_at?: string;
        };
        Relationships: [];
      };
      rate_limits: {
        Row: {
          key: string;
          hits: string[];
          updated_at: string;
          expires_at: string;
        };
        Insert: {
          key: string;
          hits?: string[];
          updated_at?: string;
          expires_at: string;
        };
        Update: {
          key?: string;
          hits?: string[];
          updated_at?: string;
          expires_at?: string;
        };
        Relationships: [];
      };
      referral_edges: {
        Row: {
          id: string;
          inviter_user_id: string;
          invitee_user_id: string;
          attributed_at: string;
        };
        Insert: {
          id?: string;
          inviter_user_id: string;
          invitee_user_id: string;
          attributed_at?: string;
        };
        Update: {
          id?: string;
          inviter_user_id?: string;
          invitee_user_id?: string;
          attributed_at?: string;
        };
        Relationships: [];
      };
      referral_erasure_blocks: {
        Row: {
          user_id_hash: string;
          erased_at: string;
        };
        Insert: {
          user_id_hash: string;
          erased_at?: string;
        };
        Update: {
          user_id_hash?: string;
          erased_at?: string;
        };
        Relationships: [];
      };
      referral_invite_codes: {
        Row: {
          inviter_user_id: string;
          code_hash: string;
          code_token: string;
          created_at: string;
        };
        Insert: {
          inviter_user_id: string;
          code_hash: string;
          code_token: string;
          created_at?: string;
        };
        Update: {
          inviter_user_id?: string;
          code_hash?: string;
          code_token?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      referral_milestone_ledger: {
        Row: {
          id: string;
          beneficiary_user_id: string;
          event_type: string;
          milestone: number;
          permanent: boolean;
          reason_code: string;
          triggering_edge_id: string;
          qualified_count_at_event: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          beneficiary_user_id: string;
          event_type: string;
          milestone: number;
          permanent?: boolean;
          reason_code: string;
          triggering_edge_id: string;
          qualified_count_at_event: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          beneficiary_user_id?: string;
          event_type?: string;
          milestone?: number;
          permanent?: boolean;
          reason_code?: string;
          triggering_edge_id?: string;
          qualified_count_at_event?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pro_feature_unlock_ledger_triggering_edge_id_fkey";
            columns: ["triggering_edge_id"];
            isOneToOne: false;
            referencedRelation: "referral_edges";
            referencedColumns: ["id"];
          },
        ];
      };
      referral_qualification_events: {
        Row: {
          id: string;
          edge_id: string;
          contribution_kind: string;
          contribution_id: string;
          accepted_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          edge_id: string;
          contribution_kind: string;
          contribution_id: string;
          accepted_at: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          edge_id?: string;
          contribution_kind?: string;
          contribution_id?: string;
          accepted_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "referral_qualification_events_edge_id_fkey";
            columns: ["edge_id"];
            isOneToOne: true;
            referencedRelation: "referral_edges";
            referencedColumns: ["id"];
          },
        ];
      };
      round_members: {
        Row: {
          id: string;
          round_id: string;
          handle: string;
          joined_at: string;
        };
        Insert: {
          id?: string;
          round_id: string;
          handle: string;
          joined_at?: string;
        };
        Update: {
          id?: string;
          round_id?: string;
          handle?: string;
          joined_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "round_members_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
        ];
      };
      round_price_line_charges: {
        Row: {
          spend_id: string;
          line_index: number;
          actor: string;
          charged_at: string;
        };
        Insert: {
          spend_id: string;
          line_index: number;
          actor: string;
          charged_at?: string;
        };
        Update: {
          spend_id?: string;
          line_index?: number;
          actor?: string;
          charged_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "round_price_line_charges_spend_id_fkey";
            columns: ["spend_id"];
            isOneToOne: false;
            referencedRelation: "round_spends";
            referencedColumns: ["id"];
          },
        ];
      };
      round_spends: {
        Row: {
          id: string;
          round_id: string;
          client_ref: string;
          payer_handle: string;
          recorded_by_handle: string;
          venue_id: string;
          venue_name: string;
          total_pence: number;
          items: Json;
          recorded_at: string;
          promotion_actor: string | null;
        };
        Insert: {
          id?: string;
          round_id: string;
          client_ref: string;
          payer_handle: string;
          recorded_by_handle: string;
          venue_id: string;
          venue_name: string;
          total_pence: number;
          items?: Json;
          recorded_at?: string;
          promotion_actor?: string | null;
        };
        Update: {
          id?: string;
          round_id?: string;
          client_ref?: string;
          payer_handle?: string;
          recorded_by_handle?: string;
          venue_id?: string;
          venue_name?: string;
          total_pence?: number;
          items?: Json;
          recorded_at?: string;
          promotion_actor?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "round_spends_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
        ];
      };
      round_stops: {
        Row: {
          id: string;
          round_id: string;
          venue_id: string;
          venue_name: string;
          added_by_handle: string;
          drop_ref: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          round_id: string;
          venue_id: string;
          venue_name: string;
          added_by_handle: string;
          drop_ref?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          round_id?: string;
          venue_id?: string;
          venue_name?: string;
          added_by_handle?: string;
          drop_ref?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "round_stops_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
        ];
      };
      rounds: {
        Row: {
          id: string;
          code: string;
          title: string;
          created_by_handle: string;
          created_at: string;
          closed_at: string | null;
        };
        Insert: {
          id?: string;
          code: string;
          title: string;
          created_by_handle: string;
          created_at?: string;
          closed_at?: string | null;
        };
        Update: {
          id?: string;
          code?: string;
          title?: string;
          created_by_handle?: string;
          created_at?: string;
          closed_at?: string | null;
        };
        Relationships: [];
      };
      saved_list_follows: {
        Row: {
          id: string;
          follower_profile_id: string;
          list_owner_profile_id: string;
          list_name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          follower_profile_id: string;
          list_owner_profile_id: string;
          list_name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          follower_profile_id?: string;
          list_owner_profile_id?: string;
          list_name?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_list_follows_follower_profile_id_fkey";
            columns: ["follower_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "saved_list_follows_list_owner_profile_id_fkey";
            columns: ["list_owner_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_lists: {
        Row: {
          id: string;
          profile_id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string;
          name?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_lists_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_pubs: {
        Row: {
          id: string;
          profile_id: string;
          venue_id: string;
          list_type: string;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          venue_id: string;
          list_type?: string;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string;
          venue_id?: string;
          list_type?: string;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_pubs_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      social_blocks: {
        Row: {
          blocker_profile_id: string;
          blocked_profile_id: string;
          created_at: string;
        };
        Insert: {
          blocker_profile_id: string;
          blocked_profile_id: string;
          created_at?: string;
        };
        Update: {
          blocker_profile_id?: string;
          blocked_profile_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_blocks_blocked_profile_id_fkey";
            columns: ["blocked_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_blocks_blocker_profile_id_fkey";
            columns: ["blocker_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      social_cheers: {
        Row: {
          post_id: string;
          actor_profile_id: string;
          created_at: string;
        };
        Insert: {
          post_id: string;
          actor_profile_id: string;
          created_at?: string;
        };
        Update: {
          post_id?: string;
          actor_profile_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_cheers_actor_profile_id_fkey";
            columns: ["actor_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_cheers_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "social_posts";
            referencedColumns: ["id"];
          },
        ];
      };
      social_comments: {
        Row: {
          id: string;
          post_id: string;
          author_profile_id: string;
          author_handle: string;
          body: string;
          status: string;
          moderation_state: string;
          idempotency_key_hash: string;
          payload_digest: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          post_id: string;
          author_profile_id: string;
          author_handle: string;
          body: string;
          status?: string;
          moderation_state?: string;
          idempotency_key_hash: string;
          payload_digest: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          post_id?: string;
          author_profile_id?: string;
          author_handle?: string;
          body?: string;
          status?: string;
          moderation_state?: string;
          idempotency_key_hash?: string;
          payload_digest?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_comments_author_profile_id_fkey";
            columns: ["author_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_comments_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "social_posts";
            referencedColumns: ["id"];
          },
        ];
      };
      social_content_reports: {
        Row: {
          id: string;
          reporter_profile_id: string;
          content_kind: string;
          content_id: string;
          reason: string;
          state: string;
          created_at: string;
          resolved_at: string | null;
          resolved_by_staff_role_id: string | null;
        };
        Insert: {
          id?: string;
          reporter_profile_id: string;
          content_kind: string;
          content_id: string;
          reason: string;
          state?: string;
          created_at?: string;
          resolved_at?: string | null;
          resolved_by_staff_role_id?: string | null;
        };
        Update: {
          id?: string;
          reporter_profile_id?: string;
          content_kind?: string;
          content_id?: string;
          reason?: string;
          state?: string;
          created_at?: string;
          resolved_at?: string | null;
          resolved_by_staff_role_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "social_content_reports_reporter_profile_id_fkey";
            columns: ["reporter_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_content_reports_resolved_by_staff_role_id_fkey";
            columns: ["resolved_by_staff_role_id"];
            isOneToOne: false;
            referencedRelation: "private_social_staff_roles";
            referencedColumns: ["id"];
          },
        ];
      };
      social_crew_invitations: {
        Row: {
          id: string;
          crew_id: string;
          target_account_id: string;
          invited_by_member_id: string;
          state: string;
          created_at: string;
          expires_at: string;
          decided_at: string | null;
        };
        Insert: {
          id?: string;
          crew_id: string;
          target_account_id: string;
          invited_by_member_id: string;
          state?: string;
          created_at?: string;
          expires_at: string;
          decided_at?: string | null;
        };
        Update: {
          id?: string;
          crew_id?: string;
          target_account_id?: string;
          invited_by_member_id?: string;
          state?: string;
          created_at?: string;
          expires_at?: string;
          decided_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "social_crew_invitations_crew_id_fkey";
            columns: ["crew_id"];
            isOneToOne: false;
            referencedRelation: "social_crews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_crew_invitations_invited_by_member_id_fkey";
            columns: ["invited_by_member_id"];
            isOneToOne: false;
            referencedRelation: "social_crew_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_crew_invitations_target_account_id_fkey";
            columns: ["target_account_id"];
            isOneToOne: false;
            referencedRelation: "private_social_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      social_crew_join_requests: {
        Row: {
          id: string;
          crew_id: string;
          requester_account_id: string;
          decided_by_member_id: string | null;
          state: string;
          created_at: string;
          expires_at: string;
          decided_at: string | null;
        };
        Insert: {
          id?: string;
          crew_id: string;
          requester_account_id: string;
          decided_by_member_id?: string | null;
          state?: string;
          created_at?: string;
          expires_at: string;
          decided_at?: string | null;
        };
        Update: {
          id?: string;
          crew_id?: string;
          requester_account_id?: string;
          decided_by_member_id?: string | null;
          state?: string;
          created_at?: string;
          expires_at?: string;
          decided_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "social_crew_join_requests_crew_id_fkey";
            columns: ["crew_id"];
            isOneToOne: false;
            referencedRelation: "social_crews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_crew_join_requests_decided_by_member_id_fkey";
            columns: ["decided_by_member_id"];
            isOneToOne: false;
            referencedRelation: "social_crew_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_crew_join_requests_requester_account_id_fkey";
            columns: ["requester_account_id"];
            isOneToOne: false;
            referencedRelation: "private_social_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      social_crew_members: {
        Row: {
          id: string;
          crew_id: string;
          social_account_id: string;
          plan_member_id: string;
          role: string;
          state: string;
          joined_at: string;
          ended_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          crew_id: string;
          social_account_id: string;
          plan_member_id: string;
          role: string;
          state?: string;
          joined_at?: string;
          ended_at?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          crew_id?: string;
          social_account_id?: string;
          plan_member_id?: string;
          role?: string;
          state?: string;
          joined_at?: string;
          ended_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_crew_members_crew_id_fkey";
            columns: ["crew_id"];
            isOneToOne: false;
            referencedRelation: "social_crews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_crew_members_plan_member_id_fkey";
            columns: ["plan_member_id"];
            isOneToOne: false;
            referencedRelation: "plan_crew_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_crew_members_social_account_id_fkey";
            columns: ["social_account_id"];
            isOneToOne: false;
            referencedRelation: "private_social_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      social_crews: {
        Row: {
          id: string;
          plan_id: string;
          owner_account_id: string;
          visibility: string;
          authority_revision: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          plan_id: string;
          owner_account_id: string;
          visibility?: string;
          authority_revision?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          plan_id?: string;
          owner_account_id?: string;
          visibility?: string;
          authority_revision?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_crews_owner_account_id_fkey";
            columns: ["owner_account_id"];
            isOneToOne: false;
            referencedRelation: "private_social_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_crews_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: true;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      social_feature_request_updates: {
        Row: {
          id: string;
          post_id: string;
          staff_role_id: string;
          status: string;
          response: string;
          idempotency_key_hash: string;
          payload_digest: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          post_id: string;
          staff_role_id: string;
          status: string;
          response: string;
          idempotency_key_hash: string;
          payload_digest: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          post_id?: string;
          staff_role_id?: string;
          status?: string;
          response?: string;
          idempotency_key_hash?: string;
          payload_digest?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_feature_request_updates_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "social_posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_feature_request_updates_staff_role_id_fkey";
            columns: ["staff_role_id"];
            isOneToOne: false;
            referencedRelation: "private_social_staff_roles";
            referencedColumns: ["id"];
          },
        ];
      };
      social_interaction_moderation_jobs: {
        Row: {
          content_kind: string;
          content_id: string;
          moderation_claim: string;
          state: string;
          attempts: number;
          next_attempt_at: string;
          lease_until: string | null;
          last_error_code: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          content_kind: string;
          content_id: string;
          moderation_claim: string;
          state?: string;
          attempts?: number;
          next_attempt_at?: string;
          lease_until?: string | null;
          last_error_code?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          content_kind?: string;
          content_id?: string;
          moderation_claim?: string;
          state?: string;
          attempts?: number;
          next_attempt_at?: string;
          lease_until?: string | null;
          last_error_code?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      social_moderation_actions: {
        Row: {
          id: string;
          staff_role_id: string;
          content_kind: string;
          content_id: string;
          action: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          staff_role_id: string;
          content_kind: string;
          content_id: string;
          action: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          staff_role_id?: string;
          content_kind?: string;
          content_id?: string;
          action?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_moderation_actions_staff_role_id_fkey";
            columns: ["staff_role_id"];
            isOneToOne: false;
            referencedRelation: "private_social_staff_roles";
            referencedColumns: ["id"];
          },
        ];
      };
      social_notifications: {
        Row: {
          id: string;
          recipient_profile_id: string;
          actor_profile_id: string;
          kind: string;
          source_post_id: string;
          source_content_id: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          recipient_profile_id: string;
          actor_profile_id: string;
          kind: string;
          source_post_id: string;
          source_content_id?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          recipient_profile_id?: string;
          actor_profile_id?: string;
          kind?: string;
          source_post_id?: string;
          source_content_id?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_notifications_actor_profile_id_fkey";
            columns: ["actor_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_notifications_recipient_profile_id_fkey";
            columns: ["recipient_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_notifications_source_post_id_fkey";
            columns: ["source_post_id"];
            isOneToOne: false;
            referencedRelation: "social_posts";
            referencedColumns: ["id"];
          },
        ];
      };
      social_oauth_states: {
        Row: {
          nonce_hash: string;
          owner_id: string;
          provider: string;
          redirect_uri: string;
          code_verifier: string;
          expires_at: string;
          consumed_at: string | null;
          created_at: string;
        };
        Insert: {
          nonce_hash: string;
          owner_id: string;
          provider: string;
          redirect_uri: string;
          code_verifier: string;
          expires_at: string;
          consumed_at?: string | null;
          created_at?: string;
        };
        Update: {
          nonce_hash?: string;
          owner_id?: string;
          provider?: string;
          redirect_uri?: string;
          code_verifier?: string;
          expires_at?: string;
          consumed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_oauth_states_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      social_post_create_requests: {
        Row: {
          author_profile_id: string;
          idempotency_key: string;
          request_digest: string;
          post_id: string;
          media_id: string | null;
          created_at: string;
        };
        Insert: {
          author_profile_id: string;
          idempotency_key: string;
          request_digest: string;
          post_id: string;
          media_id?: string | null;
          created_at?: string;
        };
        Update: {
          author_profile_id?: string;
          idempotency_key?: string;
          request_digest?: string;
          post_id?: string;
          media_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_post_create_requests_author_profile_id_fkey";
            columns: ["author_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_post_create_requests_media_id_fkey";
            columns: ["media_id"];
            isOneToOne: false;
            referencedRelation: "social_post_media";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_post_create_requests_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "social_posts";
            referencedColumns: ["id"];
          },
        ];
      };
      social_post_edit_audit: {
        Row: {
          id: string;
          post_id: string;
          actor_profile_id: string;
          from_mutation_version: number;
          to_mutation_version: number;
          changed_fields: string[];
          previous_digest: string;
          next_digest: string;
          edited_at: string;
        };
        Insert: {
          id?: string;
          post_id: string;
          actor_profile_id: string;
          from_mutation_version: number;
          to_mutation_version: number;
          changed_fields: string[];
          previous_digest: string;
          next_digest: string;
          edited_at?: string;
        };
        Update: {
          id?: string;
          post_id?: string;
          actor_profile_id?: string;
          from_mutation_version?: number;
          to_mutation_version?: number;
          changed_fields?: string[];
          previous_digest?: string;
          next_digest?: string;
          edited_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_post_edit_audit_actor_profile_id_fkey";
            columns: ["actor_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_post_edit_audit_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "social_posts";
            referencedColumns: ["id"];
          },
        ];
      };
      social_post_media: {
        Row: {
          id: string;
          generation: string;
          owner_profile_id: string;
          object_key: string;
          sha256: string;
          width: number;
          height: number;
          byte_size: number;
          content_type: string;
          moderation_state: string;
          attachment_state: string;
          retention_expires_at: string | null;
          cleanup_token: string | null;
          cleanup_lease_until: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          generation: string;
          owner_profile_id: string;
          object_key: string;
          sha256: string;
          width: number;
          height: number;
          byte_size: number;
          content_type?: string;
          moderation_state?: string;
          attachment_state?: string;
          retention_expires_at?: string | null;
          cleanup_token?: string | null;
          cleanup_lease_until?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          generation?: string;
          owner_profile_id?: string;
          object_key?: string;
          sha256?: string;
          width?: number;
          height?: number;
          byte_size?: number;
          content_type?: string;
          moderation_state?: string;
          attachment_state?: string;
          retention_expires_at?: string | null;
          cleanup_token?: string | null;
          cleanup_lease_until?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_post_media_owner_profile_id_fkey";
            columns: ["owner_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      social_post_media_lifecycle_events: {
        Row: {
          id: string;
          media_id: string;
          post_id: string;
          actor_profile_id: string;
          action: string;
          retention_expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          media_id: string;
          post_id: string;
          actor_profile_id: string;
          action: string;
          retention_expires_at: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          media_id?: string;
          post_id?: string;
          actor_profile_id?: string;
          action?: string;
          retention_expires_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      social_post_media_uploads: {
        Row: {
          media_id: string;
          generation: string;
          owner_profile_id: string;
          object_key: string;
          sha256: string;
          width: number;
          height: number;
          byte_size: number;
          state: string;
          cleanup_token: string | null;
          cleanup_lease_until: string | null;
          created_at: string;
        };
        Insert: {
          media_id: string;
          generation: string;
          owner_profile_id: string;
          object_key: string;
          sha256: string;
          width: number;
          height: number;
          byte_size: number;
          state?: string;
          cleanup_token?: string | null;
          cleanup_lease_until?: string | null;
          created_at?: string;
        };
        Update: {
          media_id?: string;
          generation?: string;
          owner_profile_id?: string;
          object_key?: string;
          sha256?: string;
          width?: number;
          height?: number;
          byte_size?: number;
          state?: string;
          cleanup_token?: string | null;
          cleanup_lease_until?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_post_media_uploads_owner_profile_id_fkey";
            columns: ["owner_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      social_post_moderation_actions: {
        Row: {
          id: string;
          staff_role_id: string;
          post_id: string;
          media_id: string | null;
          action: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          staff_role_id: string;
          post_id: string;
          media_id?: string | null;
          action: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          staff_role_id?: string;
          post_id?: string;
          media_id?: string | null;
          action?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_post_moderation_actions_media_id_fkey";
            columns: ["media_id"];
            isOneToOne: false;
            referencedRelation: "social_post_media";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_post_moderation_actions_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "social_posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_post_moderation_actions_staff_role_id_fkey";
            columns: ["staff_role_id"];
            isOneToOne: false;
            referencedRelation: "private_social_staff_roles";
            referencedColumns: ["id"];
          },
        ];
      };
      social_post_moderation_jobs: {
        Row: {
          post_id: string;
          revision: number;
          moderation_claim: string;
          state: string;
          attempts: number;
          next_attempt_at: string;
          lease_until: string | null;
          last_error_code: string | null;
          created_at: string;
          updated_at: string;
          media_id: string | null;
          lease_token: string | null;
        };
        Insert: {
          post_id: string;
          revision: number;
          moderation_claim: string;
          state?: string;
          attempts?: number;
          next_attempt_at?: string;
          lease_until?: string | null;
          last_error_code?: string | null;
          created_at?: string;
          updated_at?: string;
          media_id?: string | null;
          lease_token?: string | null;
        };
        Update: {
          post_id?: string;
          revision?: number;
          moderation_claim?: string;
          state?: string;
          attempts?: number;
          next_attempt_at?: string;
          lease_until?: string | null;
          last_error_code?: string | null;
          created_at?: string;
          updated_at?: string;
          media_id?: string | null;
          lease_token?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "social_post_moderation_jobs_media_id_fkey";
            columns: ["media_id"];
            isOneToOne: false;
            referencedRelation: "social_post_media";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_post_moderation_jobs_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: true;
            referencedRelation: "social_posts";
            referencedColumns: ["id"];
          },
        ];
      };
      social_post_remove_requests: {
        Row: {
          author_profile_id: string;
          idempotency_key: string;
          post_id: string;
          created_at: string;
        };
        Insert: {
          author_profile_id: string;
          idempotency_key: string;
          post_id: string;
          created_at?: string;
        };
        Update: {
          author_profile_id?: string;
          idempotency_key?: string;
          post_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_post_remove_requests_author_profile_id_fkey";
            columns: ["author_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_post_remove_requests_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "social_posts";
            referencedColumns: ["id"];
          },
        ];
      };
      social_post_tag_events: {
        Row: {
          id: string;
          proposal_id: string;
          actor_profile_id: string;
          action: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          proposal_id: string;
          actor_profile_id: string;
          action: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          proposal_id?: string;
          actor_profile_id?: string;
          action?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_post_tag_events_actor_profile_id_fkey";
            columns: ["actor_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_post_tag_events_proposal_id_fkey";
            columns: ["proposal_id"];
            isOneToOne: false;
            referencedRelation: "social_post_tag_proposals";
            referencedColumns: ["id"];
          },
        ];
      };
      social_post_tag_proposals: {
        Row: {
          id: string;
          post_id: string;
          media_id: string | null;
          author_profile_id: string;
          target_profile_id: string;
          state: string;
          created_at: string;
          decided_at: string | null;
          audience_visibility: string | null;
          audience_revision: number | null;
          audience_shown_at: string | null;
        };
        Insert: {
          id?: string;
          post_id: string;
          media_id?: string | null;
          author_profile_id: string;
          target_profile_id: string;
          state?: string;
          created_at?: string;
          decided_at?: string | null;
          audience_visibility?: string | null;
          audience_revision?: number | null;
          audience_shown_at?: string | null;
        };
        Update: {
          id?: string;
          post_id?: string;
          media_id?: string | null;
          author_profile_id?: string;
          target_profile_id?: string;
          state?: string;
          created_at?: string;
          decided_at?: string | null;
          audience_visibility?: string | null;
          audience_revision?: number | null;
          audience_shown_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "social_post_tag_proposals_author_profile_id_fkey";
            columns: ["author_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_post_tag_proposals_media_id_fkey";
            columns: ["media_id"];
            isOneToOne: false;
            referencedRelation: "social_post_media";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_post_tag_proposals_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "social_posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_post_tag_proposals_target_profile_id_fkey";
            columns: ["target_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      social_posts: {
        Row: {
          id: string;
          author_profile_id: string;
          author_handle: string;
          kind: string;
          visibility: string;
          status: string;
          body: string;
          area_slug: string | null;
          venue_id: string | null;
          hashtags: string[];
          comment_policy: string;
          photo_media_id: string | null;
          photo_alt_text: string | null;
          feature_status: string | null;
          feature_staff_response: string | null;
          moderation_state: string;
          revision: number;
          mutation_version: number;
          edited_at: string | null;
          moderated_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          author_profile_id: string;
          author_handle: string;
          kind: string;
          visibility: string;
          status?: string;
          body?: string;
          area_slug?: string | null;
          venue_id?: string | null;
          hashtags?: string[];
          comment_policy: string;
          photo_media_id?: string | null;
          photo_alt_text?: string | null;
          feature_status?: string | null;
          feature_staff_response?: string | null;
          moderation_state?: string;
          revision?: number;
          mutation_version?: number;
          edited_at?: string | null;
          moderated_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          author_profile_id?: string;
          author_handle?: string;
          kind?: string;
          visibility?: string;
          status?: string;
          body?: string;
          area_slug?: string | null;
          venue_id?: string | null;
          hashtags?: string[];
          comment_policy?: string;
          photo_media_id?: string | null;
          photo_alt_text?: string | null;
          feature_status?: string | null;
          feature_staff_response?: string | null;
          moderation_state?: string;
          revision?: number;
          mutation_version?: number;
          edited_at?: string | null;
          moderated_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_posts_author_profile_id_fkey";
            columns: ["author_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_posts_photo_media_fk";
            columns: ["photo_media_id"];
            isOneToOne: false;
            referencedRelation: "social_post_media";
            referencedColumns: ["id"];
          },
        ];
      };
      social_quotes: {
        Row: {
          id: string;
          source_post_id: string;
          author_profile_id: string;
          author_handle: string;
          body: string;
          visibility: string;
          status: string;
          moderation_state: string;
          idempotency_key_hash: string;
          payload_digest: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          source_post_id: string;
          author_profile_id: string;
          author_handle: string;
          body: string;
          visibility: string;
          status?: string;
          moderation_state?: string;
          idempotency_key_hash: string;
          payload_digest: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          source_post_id?: string;
          author_profile_id?: string;
          author_handle?: string;
          body?: string;
          visibility?: string;
          status?: string;
          moderation_state?: string;
          idempotency_key_hash?: string;
          payload_digest?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_quotes_author_profile_id_fkey";
            columns: ["author_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_quotes_source_post_id_fkey";
            columns: ["source_post_id"];
            isOneToOne: false;
            referencedRelation: "social_posts";
            referencedColumns: ["id"];
          },
        ];
      };
      social_reposts: {
        Row: {
          id: string;
          post_id: string;
          actor_profile_id: string;
          actor_handle: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          post_id: string;
          actor_profile_id: string;
          actor_handle: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          post_id?: string;
          actor_profile_id?: string;
          actor_handle?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_reposts_actor_profile_id_fkey";
            columns: ["actor_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_reposts_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "social_posts";
            referencedColumns: ["id"];
          },
        ];
      };
      social_saves: {
        Row: {
          post_id: string;
          actor_profile_id: string;
          created_at: string;
        };
        Insert: {
          post_id: string;
          actor_profile_id: string;
          created_at?: string;
        };
        Update: {
          post_id?: string;
          actor_profile_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_saves_actor_profile_id_fkey";
            columns: ["actor_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_saves_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "social_posts";
            referencedColumns: ["id"];
          },
        ];
      };
      step_out_nudge_prefs: {
        Row: {
          owner_actor: string;
          enabled: boolean;
          subscription_token: string | null;
          last_sent_at: string | null;
          created_at: string;
          updated_at: string;
          cheap_pint_qualified: boolean;
          cheap_pint_enabled: boolean;
          cheap_pint_declined: boolean;
          cheap_pint_sent_at: string | null;
        };
        Insert: {
          owner_actor: string;
          enabled?: boolean;
          subscription_token?: string | null;
          last_sent_at?: string | null;
          created_at?: string;
          updated_at?: string;
          cheap_pint_qualified?: boolean;
          cheap_pint_enabled?: boolean;
          cheap_pint_declined?: boolean;
          cheap_pint_sent_at?: string | null;
        };
        Update: {
          owner_actor?: string;
          enabled?: boolean;
          subscription_token?: string | null;
          last_sent_at?: string | null;
          created_at?: string;
          updated_at?: string;
          cheap_pint_qualified?: boolean;
          cheap_pint_enabled?: boolean;
          cheap_pint_declined?: boolean;
          cheap_pint_sent_at?: string | null;
        };
        Relationships: [];
      };
      structured_visit_reports: {
        Row: {
          id: string;
          venue_id: string;
          handle: string;
          visited_at: string;
          busyness: string | null;
          atmosphere: string | null;
          would_return: string | null;
          price_sanity: string | null;
          note: string;
          status: string;
          report_count: number;
          report_actors: string[];
          reported_at: string | null;
          report_reason: string | null;
          moderated_at: string | null;
          moderator_note: string | null;
          created_at: string;
          noise: string | null;
          seating: string | null;
          service_wait: string | null;
          author_retired_at: string | null;
        };
        Insert: {
          id?: string;
          venue_id: string;
          handle: string;
          visited_at: string;
          busyness?: string | null;
          atmosphere?: string | null;
          would_return?: string | null;
          price_sanity?: string | null;
          note?: string;
          status?: string;
          report_count?: number;
          report_actors?: string[];
          reported_at?: string | null;
          report_reason?: string | null;
          moderated_at?: string | null;
          moderator_note?: string | null;
          created_at?: string;
          noise?: string | null;
          seating?: string | null;
          service_wait?: string | null;
          author_retired_at?: string | null;
        };
        Update: {
          id?: string;
          venue_id?: string;
          handle?: string;
          visited_at?: string;
          busyness?: string | null;
          atmosphere?: string | null;
          would_return?: string | null;
          price_sanity?: string | null;
          note?: string;
          status?: string;
          report_count?: number;
          report_actors?: string[];
          reported_at?: string | null;
          report_reason?: string | null;
          moderated_at?: string | null;
          moderator_note?: string | null;
          created_at?: string;
          noise?: string | null;
          seating?: string | null;
          service_wait?: string | null;
          author_retired_at?: string | null;
        };
        Relationships: [];
      };
      venue_occupancy_flags: {
        Row: {
          id: string;
          occupancy_report_id: string;
          actor_hash: string;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          occupancy_report_id: string;
          actor_hash: string;
          reason?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          occupancy_report_id?: string;
          actor_hash?: string;
          reason?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "venue_occupancy_flags_occupancy_report_id_fkey";
            columns: ["occupancy_report_id"];
            isOneToOne: false;
            referencedRelation: "venue_occupancy_reports";
            referencedColumns: ["id"];
          },
        ];
      };
      venue_occupancy_reports: {
        Row: {
          id: string;
          venue_id: string;
          reported_at: string;
          level: string;
          reporter_user_id: string;
          source: string;
          hidden_at: string | null;
          flagged_at: string | null;
          report_reason: string | null;
          report_count: number;
        };
        Insert: {
          id: string;
          venue_id: string;
          reported_at?: string;
          level: string;
          reporter_user_id: string;
          source?: string;
          hidden_at?: string | null;
          flagged_at?: string | null;
          report_reason?: string | null;
          report_count?: number;
        };
        Update: {
          id?: string;
          venue_id?: string;
          reported_at?: string;
          level?: string;
          reporter_user_id?: string;
          source?: string;
          hidden_at?: string | null;
          flagged_at?: string | null;
          report_reason?: string | null;
          report_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "venue_occupancy_reports_reporter_user_id_fkey";
            columns: ["reporter_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      venue_operators: {
        Row: {
          id: string;
          account_id: string;
          venue_id: string;
          verification_state: string;
          evidence_kind: string;
          evidence_note: string;
          reviewed_at: string | null;
          reviewer_note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          venue_id: string;
          verification_state?: string;
          evidence_kind: string;
          evidence_note?: string;
          reviewed_at?: string | null;
          reviewer_note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          venue_id?: string;
          verification_state?: string;
          evidence_kind?: string;
          evidence_note?: string;
          reviewed_at?: string | null;
          reviewer_note?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      venue_photos: {
        Row: {
          id: string;
          venue_id: string | null;
          author_actor: string;
          author_profile_id: string;
          object_key: string;
          drink_category: string | null;
          caption: string;
          width: number;
          height: number;
          moderation_state: string;
          report_count: number;
          report_actors: string[];
          reported_at: string | null;
          report_reason: string | null;
          moderated_at: string | null;
          moderator_note: string | null;
          created_at: string;
          wall_category: string;
          place_label: string;
        };
        Insert: {
          id: string;
          venue_id?: string | null;
          author_actor: string;
          author_profile_id: string;
          object_key: string;
          drink_category?: string | null;
          caption?: string;
          width: number;
          height: number;
          moderation_state?: string;
          report_count?: number;
          report_actors?: string[];
          reported_at?: string | null;
          report_reason?: string | null;
          moderated_at?: string | null;
          moderator_note?: string | null;
          created_at?: string;
          wall_category?: string;
          place_label?: string;
        };
        Update: {
          id?: string;
          venue_id?: string | null;
          author_actor?: string;
          author_profile_id?: string;
          object_key?: string;
          drink_category?: string | null;
          caption?: string;
          width?: number;
          height?: number;
          moderation_state?: string;
          report_count?: number;
          report_actors?: string[];
          reported_at?: string | null;
          report_reason?: string | null;
          moderated_at?: string | null;
          moderator_note?: string | null;
          created_at?: string;
          wall_category?: string;
          place_label?: string;
        };
        Relationships: [
          {
            foreignKeyName: "venue_photos_author_profile_id_fkey";
            columns: ["author_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      venue_ratings: {
        Row: {
          id: string;
          venue_id: string;
          handle: string;
          rating: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          venue_id: string;
          handle: string;
          rating: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          venue_id?: string;
          handle?: string;
          rating?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      walk_route_legs: {
        Row: {
          leg_key: string;
          coordinates: Json;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          leg_key: string;
          coordinates: Json;
          expires_at: string;
          created_at?: string;
        };
        Update: {
          leg_key?: string;
          coordinates?: Json;
          expires_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      wanteds: {
        Row: {
          id: string;
          owner_actor: string;
          venue_kind: string;
          venue_id: string | null;
          venue_name: string | null;
          source_url: string | null;
          source_platform: string;
          note: string;
          raw_paste: string;
          status: string;
          created_at: string;
          fulfilled_at: string | null;
          promoted_list_type: string | null;
          promoted_at: string | null;
        };
        Insert: {
          id?: string;
          owner_actor: string;
          venue_kind: string;
          venue_id?: string | null;
          venue_name?: string | null;
          source_url?: string | null;
          source_platform?: string;
          note?: string;
          raw_paste?: string;
          status?: string;
          created_at?: string;
          fulfilled_at?: string | null;
          promoted_list_type?: string | null;
          promoted_at?: string | null;
        };
        Update: {
          id?: string;
          owner_actor?: string;
          venue_kind?: string;
          venue_id?: string | null;
          venue_name?: string | null;
          source_url?: string | null;
          source_platform?: string;
          note?: string;
          raw_paste?: string;
          status?: string;
          created_at?: string;
          fulfilled_at?: string | null;
          promoted_list_type?: string | null;
          promoted_at?: string | null;
        };
        Relationships: [];
      };
      weather_recommendations: {
        Row: {
          id: string;
          venue_id: string;
          condition: string;
          reason: string;
          contributor_handle: string;
          actor_hash: string;
          submitted_at: string;
          status: string;
          moderated_at: string | null;
          moderator_note: string | null;
          author_retired_at: string | null;
        };
        Insert: {
          id?: string;
          venue_id: string;
          condition: string;
          reason: string;
          contributor_handle: string;
          actor_hash: string;
          submitted_at?: string;
          status?: string;
          moderated_at?: string | null;
          moderator_note?: string | null;
          author_retired_at?: string | null;
        };
        Update: {
          id?: string;
          venue_id?: string;
          condition?: string;
          reason?: string;
          contributor_handle?: string;
          actor_hash?: string;
          submitted_at?: string;
          status?: string;
          moderated_at?: string | null;
          moderator_note?: string | null;
          author_retired_at?: string | null;
        };
        Relationships: [];
      };
      weather_snapshots: {
        Row: {
          night_area: string;
          observed_at: string;
          expires_at: string;
          condition: string;
          feels_like_c: number;
          precipitation_probability_pct: number;
          wind_kph: number | null;
          source_url: string;
          source_publisher: string;
          source_published_at: string;
          generated_at: string;
          updated_at: string;
        };
        Insert: {
          night_area: string;
          observed_at: string;
          expires_at: string;
          condition: string;
          feels_like_c: number;
          precipitation_probability_pct: number;
          wind_kph?: number | null;
          source_url: string;
          source_publisher: string;
          source_published_at: string;
          generated_at: string;
          updated_at?: string;
        };
        Update: {
          night_area?: string;
          observed_at?: string;
          expires_at?: string;
          condition?: string;
          feels_like_c?: number;
          precipitation_probability_pct?: number;
          wind_kph?: number | null;
          source_url?: string;
          source_publisher?: string;
          source_published_at?: string;
          generated_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      whats_on_listing_generations: {
        Row: {
          kind: string;
          generated_at: string;
        };
        Insert: {
          kind: string;
          generated_at: string;
        };
        Update: {
          kind?: string;
          generated_at?: string;
        };
        Relationships: [];
      };
      whats_on_listings: {
        Row: {
          id: string;
          kind: string;
          payload: Json;
          observed_at: string;
          generated_at: string;
          city: string;
        };
        Insert: {
          id: string;
          kind: string;
          payload: Json;
          observed_at: string;
          generated_at: string;
          city?: string;
        };
        Update: {
          id?: string;
          kind?: string;
          payload?: Json;
          observed_at?: string;
          generated_at?: string;
          city?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      community_contributor_counts: {
        Row: {
          contributor_key: string | null;
          price_count: number | null;
          venue_signal_count: number | null;
          total: number | null;
        };
        Relationships: [];
      };
      pnc_qualified_completions: {
        Row: {
          completion_id: string | null;
          plan_id: string | null;
          completed_at: string | null;
          completion_day_utc: string | null;
          ending: string | null;
          route_revision: number | null;
          qualifying_arrival_at: string | null;
        };
        Insert: {
          completion_id?: string | null;
          plan_id?: string | null;
          completed_at?: string | null;
          completion_day_utc?: string | null;
          ending?: string | null;
          route_revision?: number | null;
          qualifying_arrival_at?: string | null;
        };
        Update: {
          completion_id?: string | null;
          plan_id?: string | null;
          completed_at?: string | null;
          completion_day_utc?: string | null;
          ending?: string | null;
          route_revision?: number | null;
          qualifying_arrival_at?: string | null;
        };
        Relationships: [];
      };
      visit_reports: {
        Row: {
          id: string | null;
          venue_id: string | null;
          handle: string | null;
          drink: string | null;
          price_gbp: number | null;
          passed_down_note: string | null;
          era: string | null;
          pint_photo_key: string | null;
          provenance: string | null;
          status: string | null;
          created_at: string | null;
          venue_photo_key: string | null;
          reported_at: string | null;
          report_reason: string | null;
          report_count: number | null;
          moderated_at: string | null;
          moderator_note: string | null;
          vibe_tags: string[] | null;
          visibility: string | null;
          leave_by_iso: string | null;
          last_train_decision: string | null;
          verified_report_count: number | null;
          authority_key: string | null;
        };
        Insert: {
          id?: string | null;
          venue_id?: string | null;
          handle?: string | null;
          drink?: string | null;
          price_gbp?: number | null;
          passed_down_note?: string | null;
          era?: string | null;
          pint_photo_key?: string | null;
          provenance?: string | null;
          status?: string | null;
          created_at?: string | null;
          venue_photo_key?: string | null;
          reported_at?: string | null;
          report_reason?: string | null;
          report_count?: number | null;
          moderated_at?: string | null;
          moderator_note?: string | null;
          vibe_tags?: string[] | null;
          visibility?: string | null;
          leave_by_iso?: string | null;
          last_train_decision?: string | null;
          verified_report_count?: number | null;
          authority_key?: string | null;
        };
        Update: {
          id?: string | null;
          venue_id?: string | null;
          handle?: string | null;
          drink?: string | null;
          price_gbp?: number | null;
          passed_down_note?: string | null;
          era?: string | null;
          pint_photo_key?: string | null;
          provenance?: string | null;
          status?: string | null;
          created_at?: string | null;
          venue_photo_key?: string | null;
          reported_at?: string | null;
          report_reason?: string | null;
          report_count?: number | null;
          moderated_at?: string | null;
          moderator_note?: string | null;
          vibe_tags?: string[] | null;
          visibility?: string | null;
          leave_by_iso?: string | null;
          last_train_decision?: string | null;
          verified_report_count?: number | null;
          authority_key?: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      _0075_add_plan_action_idempotent_atomic: {
        Args: {
          p_plan_id: string | null;
          p_token_hash: string | null;
          p_action_id: string | null;
          p_type: string | null;
          p_stop_position: number | null;
          p_idempotency_key_hash: string | null;
          p_request_hash: string | null;
          p_created_at: string | null;
        };
        Returns: string;
      };
      _0075_complete_plan_atomic_8: {
        Args: {
          p_plan_id: string | null;
          p_token_hash: string | null;
          p_expected_route_revision: number | null;
          p_completion_id: string | null;
          p_action_id: string | null;
          p_ending: string | null;
          p_terminal_venue_id: string | null;
          p_completed_at: string | null;
        };
        Returns: string;
      };
      _0075_complete_plan_atomic_9: {
        Args: {
          p_plan_id: string | null;
          p_token_hash: string | null;
          p_expected_route_revision: number | null;
          p_completion_id: string | null;
          p_action_id: string | null;
          p_ending: string | null;
          p_terminal_venue_id: string | null;
          p_ending_selection: Json;
          p_completed_at: string | null;
        };
        Returns: string;
      };
      _0075_create_plan_recap_atomic: {
        Args: {
          p_owner_id: string | null;
          p_completion_id: string | null;
          p_title: string | null;
          p_completed_at: string | null;
          p_stops: Json;
        };
        Returns: string;
      };
      _0075_decide_plan_route_proposal_atomic: {
        Args: {
          p_plan_id: string | null;
          p_proposal_id: string | null;
          p_token_hash: string | null;
          p_decision: string | null;
          p_idempotency_key: string | null;
          p_decided_at: string | null;
        };
        Returns: string;
      };
      _0075_join_plan_atomic: {
        Args: {
          p_plan_id: string | null;
          p_member_id: string | null;
          p_member_name: string | null;
          p_token_hash: string | null;
          p_joined_at: string | null;
          p_can_collaborate: boolean | null;
        };
        Returns: boolean;
      };
      _0075_join_plan_idempotent_atomic: {
        Args: {
          p_plan_id: string | null;
          p_member_id: string | null;
          p_member_name: string | null;
          p_token_hash: string | null;
          p_joined_at: string | null;
          p_can_collaborate: boolean | null;
          p_idempotency_key_hash: string | null;
          p_request_hash: string | null;
        };
        Returns: string;
      };
      _0075_record_plan_vibe_vote_atomic: {
        Args: {
          p_plan_id: string | null;
          p_member_id: string | null;
          p_vibe: string | null;
          p_idempotency_key: string | null;
          p_vote_id: string | null;
          p_created_at: string | null;
        };
        Returns: Json;
      };
      _0075_record_plan_vote_atomic: {
        Args: {
          p_plan_id: string | null;
          p_proposal_id: string | null;
          p_member_id: string | null;
          p_value: string | null;
          p_idempotency_key: string | null;
          p_vote_id: string | null;
          p_created_at: string | null;
        };
        Returns: Json;
      };
      _0075_redeem_plan_invite_atomic: {
        Args: {
          p_plan_id: string | null;
          p_invite_token_hash: string | null;
          p_member_id: string | null;
          p_member_name: string | null;
          p_member_token_hash: string | null;
          p_joined_at: string | null;
        };
        Returns: string;
      };
      _0075_redeem_plan_invite_idempotent_atomic: {
        Args: {
          p_plan_id: string | null;
          p_invite_token_hash: string | null;
          p_member_id: string | null;
          p_member_name: string | null;
          p_member_token_hash: string | null;
          p_joined_at: string | null;
          p_idempotency_key_hash: string | null;
          p_request_hash: string | null;
        };
        Returns: string;
      };
      _0075_replace_plan_route_atomic: {
        Args: {
          p_plan_id: string | null;
          p_token_hash: string | null;
          p_expected_route_revision: number | null;
          p_stops: Json;
          p_context: Json;
          p_grounded_upgrade?: boolean | null;
        };
        Returns: string;
      };
      _0075_upgrade_plan_member_invite_atomic: {
        Args: {
          p_plan_id: string | null;
          p_invite_token_hash: string | null;
          p_member_token_hash: string | null;
          p_redeemed_at: string | null;
        };
        Returns: string;
      };
      _activate_social_crew_member: {
        Args: {
          p_crew: string | null;
          p_account: string | null;
        };
        Returns: string;
      };
      _reconcile_plan_account_join: {
        Args: {
          p_plan_id: string | null;
          p_member_id: string | null;
          p_member_name: string | null;
          p_member_token_hash: string | null;
          p_idempotency_key_hash: string | null;
          p_request_hash: string | null;
          p_anonymous_request_hash: string | null;
          p_can_collaborate: boolean | null;
          p_user_id: string | null;
        };
        Returns: string;
      };
      _social_crew_begin_write: {
        Args: {
          p_actor: string | null;
          p_operation: string | null;
          p_key: string | null;
          p_digest: string | null;
        };
        Returns: Json;
      };
      _social_crew_fail_write: {
        Args: {
          p_actor: string | null;
          p_operation: string | null;
          p_key: string | null;
          p_digest: string | null;
          p_code: string | null;
        };
        Returns: Json;
      };
      _social_crew_finish_write: {
        Args: {
          p_actor: string | null;
          p_operation: string | null;
          p_key: string | null;
          p_digest: string | null;
          p_response: Json;
        };
        Returns: Json;
      };
      _social_crew_member_role: {
        Args: {
          p_crew: string | null;
          p_actor: string | null;
        };
        Returns: string;
      };
      _social_crew_plan_expiry: {
        Args: {
          p_crew: string | null;
        };
        Returns: string;
      };
      _social_crew_relationship_between_accounts: {
        Args: {
          p_first: string | null;
          p_second: string | null;
        };
        Returns: string;
      };
      _social_plan_is_bound: {
        Args: {
          p_plan_id: string | null;
        };
        Returns: boolean;
      };
      accept_social_crew_invitation_atomic: {
        Args: {
          p_actor_account_id: string | null;
          p_crew_id: string | null;
          p_invitation_id: string | null;
          p_action: string | null;
          p_idempotency_key: string | null;
          p_payload_digest: string | null;
        };
        Returns: Json;
      };
      account_has_password: {
        Args: {
          p_user_id: string | null;
        };
        Returns: boolean;
      };
      act_social_post_tag: {
        Args: {
          p_actor: string | null;
          p_proposal_id: string | null;
          p_action: string | null;
          p_expected_audience_revision?: number | null;
        };
        Returns: boolean;
      };
      add_plan_action_idempotent_atomic: {
        Args: {
          p_plan_id: string | null;
          p_token_hash: string | null;
          p_action_id: string | null;
          p_type: string | null;
          p_stop_position: number | null;
          p_idempotency_key_hash: string | null;
          p_request_hash: string | null;
          p_created_at: string | null;
        };
        Returns: string;
      };
      add_plan_constraint_atomic: {
        Args: {
          p_plan_id: string | null;
          p_constraint_id: string | null;
          p_member_id: string | null;
          p_kind: string | null;
          p_value: string | null;
          p_priority: string | null;
          p_idempotency_key: string | null;
          p_created_at: string | null;
        };
        Returns: Json;
      };
      append_profile_cover_photo_report_actor: {
        Args: {
          p_id: string | null;
          p_actor: string | null;
          p_reason?: string | null;
        };
        Returns: boolean;
      };
      append_profile_image_report_actor: {
        Args: {
          p_handle: string | null;
          p_slot: string | null;
          p_actor: string | null;
          p_reason?: string | null;
        };
        Returns: boolean;
      };
      append_social_feature_update: {
        Args: {
          p_actor: string | null;
          p_post_id: string | null;
          p_status: string | null;
          p_response: string | null;
          p_idempotency_key_hash: string | null;
          p_payload_digest: string | null;
        };
        Returns: Database["public"]["Tables"]["social_feature_request_updates"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "social_feature_request_updates";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      append_venue_photo_report_actor: {
        Args: {
          p_id: string | null;
          p_actor: string | null;
          p_reason?: string | null;
        };
        Returns: boolean;
      };
      append_visit_report_report_actor: {
        Args: {
          p_id: string | null;
          p_actor: string | null;
          p_reason?: string | null;
        };
        Returns: boolean;
      };
      charge_round_price_line: {
        Args: {
          p_actor: string | null;
          p_key: string | null;
          p_limit: number | null;
          p_line_index: number | null;
          p_spend_id: string | null;
          p_window_ms: number | null;
        };
        Returns: string;
      };
      check_rate_limit: {
        Args: {
          p_key: string | null;
          p_limit: number | null;
          p_window_ms: number | null;
        };
        Returns: boolean;
      };
      claim_analytics_event_receipt: {
        Args: {
          p_event_id: string | null;
          p_token_hash: string | null;
          p_event_name: string | null;
          p_now: string | null;
          p_lease_until: string | null;
        };
        Returns: string;
      };
      claim_plan_membership: {
        Args: {
          p_plan_id: string | null;
          p_member_id: string | null;
          p_user_id: string | null;
        };
        Returns: string;
      };
      claim_pubmaxx_handle: {
        Args: {
          p_user_id: string | null;
          p_handle: string | null;
        };
        Returns: Json;
      };
      claim_referral_code: {
        Args: {
          p_code_hash: string | null;
          p_invitee_user_id: string | null;
          p_auth_attempt_started_at: string | null;
          p_now: string | null;
        };
        Returns: Json;
      };
      claim_social_interaction_moderation_jobs: {
        Args: {
          p_limit?: number | null;
        };
        Returns: {
          content_kind: string;
          content_id: string;
          moderation_claim: string;
          attempts: number;
        }[];
      };
      claim_social_post_media_cleanup_batch: {
        Args: {
          p_limit?: number | null;
        };
        Returns: {
          media_id: string;
          generation: string;
          object_key: string;
          cleanup_token: string;
        }[];
      };
      claim_social_post_media_upload_cleanup: {
        Args: {
          p_owner_profile_id: string | null;
          p_media_id: string | null;
          p_generation: string | null;
        };
        Returns: {
          generation: string;
          object_key: string;
          cleanup_token: string;
        }[];
      };
      claim_social_post_media_upload_cleanup_batch: {
        Args: {
          p_limit: number | null;
          p_staged_before: string | null;
        };
        Returns: {
          media_id: string;
          generation: string;
          object_key: string;
          cleanup_token: string;
        }[];
      };
      claim_social_post_moderation_jobs: {
        Args: {
          p_limit?: number | null;
        };
        Returns: {
          post_id: string;
          revision: number;
          media_id: string;
          object_key: string;
          moderation_claim: string;
          attempts: number;
          lease_token: string;
        }[];
      };
      complete_analytics_event_receipt: {
        Args: {
          p_event_id: string | null;
          p_delivered_at: string | null;
        };
        Returns: boolean;
      };
      complete_contributor_onboarding: {
        Args: {
          p_user_id: string | null;
          p_handle: string | null;
          p_date_of_birth: string | null;
          p_full_name?: string | null;
          p_sex?: string | null;
        };
        Returns: Json;
      };
      complete_plan_atomic:
        | {
        Args: {
          p_plan_id: string | null;
          p_token_hash: string | null;
          p_expected_route_revision: number | null;
          p_completion_id: string | null;
          p_action_id: string | null;
          p_ending: string | null;
          p_terminal_venue_id: string | null;
          p_completed_at: string | null;
        };
        Returns: string;
      }
        | {
        Args: {
          p_plan_id: string | null;
          p_token_hash: string | null;
          p_expected_route_revision: number | null;
          p_completion_id: string | null;
          p_action_id: string | null;
          p_ending: string | null;
          p_terminal_venue_id: string | null;
          p_ending_selection: Json;
          p_completed_at: string | null;
        };
        Returns: string;
      };
      complete_social_interaction_moderation: {
        Args: {
          p_kind: string | null;
          p_content_id: string | null;
          p_decision: string | null;
        };
        Returns: boolean;
      };
      complete_social_interaction_moderation_job: {
        Args: {
          p_kind: string | null;
          p_content_id: string | null;
          p_decision: string | null;
          p_error_code: string | null;
          p_retry_at: string | null;
        };
        Returns: boolean;
      };
      complete_social_post_moderation_job: {
        Args: {
          p_post_id: string | null;
          p_revision: number | null;
          p_media_id: string | null;
          p_lease_token: string | null;
          p_decision?: string | null;
          p_error_code?: string | null;
          p_retry_at?: string | null;
        };
        Returns: boolean;
      };
      confirm_night_story_publication: {
        Args: {
          p_proposal_id: string | null;
          p_story_id: string | null;
          p_requested_by: string | null;
          p_token_hash: string | null;
        };
        Returns: boolean;
      };
      consume_plan_invite_atomic: {
        Args: {
          p_plan_id: string | null;
          p_token_hash: string | null;
          p_redeemed_at: string | null;
        };
        Returns: Json;
      };
      consume_pub_pal_voice_trial: {
        Args: {
          p_owner_id: string | null;
          p_month: string | null;
          p_limit: number | null;
        };
        Returns: boolean;
      };
      consume_social_oauth_state: {
        Args: {
          p_nonce_hash: string | null;
          p_provider: string | null;
        };
        Returns: Json;
      };
      create_plan_atomic: {
        Args: {
          p_id: string | null;
          p_title: string | null;
          p_start_time: string | null;
          p_stops: Json;
          p_member_id: string | null;
          p_member_name: string | null;
          p_token_hash: string | null;
          p_joined_at: string | null;
        };
        Returns: undefined;
      };
      create_plan_idempotent_atomic: {
        Args: {
          p_id: string | null;
          p_title: string | null;
          p_start_time: string | null;
          p_stops: Json;
          p_member_id: string | null;
          p_member_name: string | null;
          p_token_hash: string | null;
          p_joined_at: string | null;
          p_idempotency_key_hash: string | null;
          p_request_hash: string | null;
          p_anchor_venue_id?: string | null;
          p_anchor_source?: string | null;
          p_outcome?: string | null;
        };
        Returns: string;
      };
      create_plan_invite_atomic: {
        Args: {
          p_plan_id: string | null;
          p_invite_id: string | null;
          p_created_by_member_id: string | null;
          p_token_hash: string | null;
          p_idempotency_key: string | null;
          p_created_at: string | null;
          p_expires_at: string | null;
        };
        Returns: Json;
      };
      create_plan_recap_atomic: {
        Args: {
          p_owner_id: string | null;
          p_completion_id: string | null;
          p_title: string | null;
          p_completed_at: string | null;
          p_stops: Json;
        };
        Returns: string;
      };
      create_plan_route_proposal_atomic: {
        Args: {
          p_plan_id: string | null;
          p_proposal_id: string | null;
          p_proposed_by_member_id: string | null;
          p_expected_route_revision: number | null;
          p_stops: Json;
          p_reason: string | null;
          p_resolved_constraint_ids: Json;
          p_unresolved_constraint_ids: Json;
          p_idempotency_key: string | null;
          p_created_at: string | null;
        };
        Returns: Json;
      };
      create_plan_with_context_idempotent_atomic: {
        Args: {
          p_id: string | null;
          p_title: string | null;
          p_start_time: string | null;
          p_stops: Json;
          p_member_id: string | null;
          p_member_name: string | null;
          p_token_hash: string | null;
          p_joined_at: string | null;
          p_idempotency_key_hash: string | null;
          p_request_hash: string | null;
          p_anchor_venue_id: string | null;
          p_anchor_source: string | null;
          p_outcome: string | null;
          p_context: Json;
        };
        Returns: string;
      };
      create_social_comment: {
        Args: {
          p_actor: string | null;
          p_post_id: string | null;
          p_author_handle: string | null;
          p_body: string | null;
          p_idempotency_key_hash: string | null;
          p_payload_digest: string | null;
        };
        Returns: Database["public"]["Tables"]["social_comments"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "social_comments";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      create_social_crew_atomic: {
        Args: {
          p_actor_account_id: string | null;
          p_plan_id: string | null;
          p_host_token_hash: string | null;
          p_visibility: string | null;
          p_idempotency_key: string | null;
          p_payload_digest: string | null;
        };
        Returns: Json;
      };
      create_social_post: {
        Args: {
          p_author_profile_id: string | null;
          p_author_handle: string | null;
          p_kind: string | null;
          p_visibility: string | null;
          p_body: string | null;
          p_area_slug: string | null;
          p_venue_id: string | null;
          p_hashtags: string[] | null;
          p_comment_policy: string | null;
          p_media_id: string | null;
          p_object_key: string | null;
          p_sha256: string | null;
          p_width: number | null;
          p_height: number | null;
          p_byte_size: number | null;
          p_photo_alt_text: string | null;
          p_tag_handles: string[] | null;
        };
        Returns: Database["public"]["Tables"]["social_posts"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "social_posts";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      create_social_post_idempotent: {
        Args: {
          p_author_profile_id: string | null;
          p_author_handle: string | null;
          p_kind: string | null;
          p_visibility: string | null;
          p_body: string | null;
          p_area_slug: string | null;
          p_venue_id: string | null;
          p_hashtags: string[] | null;
          p_comment_policy: string | null;
          p_media_id: string | null;
          p_object_key: string | null;
          p_sha256: string | null;
          p_width: number | null;
          p_height: number | null;
          p_byte_size: number | null;
          p_photo_alt_text: string | null;
          p_tag_handles: string[] | null;
          p_idempotency_key: string | null;
          p_request_digest: string | null;
        };
        Returns: Database["public"]["Tables"]["social_posts"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "social_posts";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      create_social_quote: {
        Args: {
          p_actor: string | null;
          p_post_id: string | null;
          p_author_handle: string | null;
          p_body: string | null;
          p_visibility: string | null;
          p_idempotency_key_hash: string | null;
          p_payload_digest: string | null;
        };
        Returns: Database["public"]["Tables"]["social_quotes"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "social_quotes";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      decide_plan_route_proposal_atomic: {
        Args: {
          p_plan_id: string | null;
          p_proposal_id: string | null;
          p_token_hash: string | null;
          p_decision: string | null;
          p_idempotency_key: string | null;
          p_decided_at: string | null;
        };
        Returns: string;
      };
      decide_social_crew_join_request_atomic: {
        Args: {
          p_actor_account_id: string | null;
          p_crew_id: string | null;
          p_request_id: string | null;
          p_decision: string | null;
          p_idempotency_key: string | null;
          p_payload_digest: string | null;
        };
        Returns: Json;
      };
      edit_social_post: {
        Args: {
          p_post_id: string | null;
          p_author_profile_id: string | null;
          p_expected_mutation_version: number | null;
          p_kind: string | null;
          p_visibility: string | null;
          p_body: string | null;
          p_area_slug: string | null;
          p_venue_id: string | null;
          p_hashtags: string[] | null;
          p_comment_policy: string | null;
          p_photo_media_id: string | null;
          p_photo_alt_text: string | null;
          p_content_changed: boolean | null;
        };
        Returns: Database["public"]["Tables"]["social_posts"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "social_posts";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      edit_social_post_with_media: {
        Args: {
          p_post_id: string | null;
          p_author_profile_id: string | null;
          p_expected_mutation_version: number | null;
          p_kind: string | null;
          p_visibility: string | null;
          p_body: string | null;
          p_area_slug: string | null;
          p_venue_id: string | null;
          p_hashtags: string[] | null;
          p_comment_policy: string | null;
          p_photo_media_id: string | null;
          p_photo_alt_text: string | null;
          p_content_changed: boolean | null;
          p_object_key: string | null;
          p_sha256: string | null;
          p_width: number | null;
          p_height: number | null;
          p_byte_size: number | null;
          p_tag_handles: string[] | null;
        };
        Returns: Database["public"]["Tables"]["social_posts"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "social_posts";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      enqueue_price_trust_reconciliation: {
        Args: {
          p_venue_id: string | null;
          p_category: string | null;
        };
        Returns: {
          venue_id: string;
          category: string;
          version: number;
          enqueued_at: string;
        }[];
      };
      erase_referral_account: {
        Args: {
          p_user_id: string | null;
        };
        Returns: undefined;
      };
      finalize_social_post_media_cleanup: {
        Args: {
          p_media_id: string | null;
          p_generation: string | null;
          p_cleanup_token: string | null;
        };
        Returns: boolean;
      };
      finalize_social_post_media_upload_cleanup: {
        Args: {
          p_media_id: string | null;
          p_generation: string | null;
          p_cleanup_token: string | null;
        };
        Returns: boolean;
      };
      get_or_create_referral_invite_code: {
        Args: {
          p_inviter_user_id: string | null;
          p_code_hash: string | null;
          p_code_token: string | null;
          p_created_at: string | null;
        };
        Returns: Json;
      };
      invite_social_crew_member_atomic: {
        Args: {
          p_actor_account_id: string | null;
          p_crew_id: string | null;
          p_target_profile_id: string | null;
          p_idempotency_key: string | null;
          p_payload_digest: string | null;
        };
        Returns: Json;
      };
      join_plan_account_idempotent_atomic: {
        Args: {
          p_plan_id: string | null;
          p_member_id: string | null;
          p_member_name: string | null;
          p_token_hash: string | null;
          p_joined_at: string | null;
          p_can_collaborate: boolean | null;
          p_idempotency_key_hash: string | null;
          p_request_hash: string | null;
          p_user_id: string | null;
        };
        Returns: string;
      };
      join_plan_atomic: {
        Args: {
          p_plan_id: string | null;
          p_member_id: string | null;
          p_member_name: string | null;
          p_token_hash: string | null;
          p_joined_at: string | null;
          p_can_collaborate: boolean | null;
        };
        Returns: boolean;
      };
      join_plan_idempotent_atomic: {
        Args: {
          p_plan_id: string | null;
          p_member_id: string | null;
          p_member_name: string | null;
          p_token_hash: string | null;
          p_joined_at: string | null;
          p_can_collaborate: boolean | null;
          p_idempotency_key_hash: string | null;
          p_request_hash: string | null;
        };
        Returns: string;
      };
      leave_social_crew_atomic: {
        Args: {
          p_actor_account_id: string | null;
          p_crew_id: string | null;
          p_idempotency_key: string | null;
          p_payload_digest: string | null;
        };
        Returns: Json;
      };
      list_open_social_crews: {
        Args: {
          p_from: string | null;
          p_until: string | null;
          p_city: string | null;
          p_limit: number | null;
        };
        Returns: Json;
      };
      mark_social_notification_read: {
        Args: {
          p_viewer: string | null;
          p_id: string | null;
          p_read: boolean | null;
        };
        Returns: boolean;
      };
      migrate_social_product_account: {
        Args: {
          p_clerk_user_id: string | null;
          p_supabase_user_id: string | null;
        };
        Returns: Json;
      };
      moderate_profile_cover_across_stores: {
        Args: {
          p_handle: string | null;
          p_state: string | null;
          p_note?: string | null;
        };
        Returns: boolean;
      };
      moderate_social_interaction: {
        Args: {
          p_actor: string | null;
          p_kind: string | null;
          p_content_id: string | null;
          p_action: string | null;
        };
        Returns: boolean;
      };
      moderate_social_post: {
        Args: {
          p_actor: string | null;
          p_post_id: string | null;
          p_media_id: string | null;
          p_action: string | null;
        };
        Returns: boolean;
      };
      moderate_social_post_admin:
        | {
        Args: {
          p_staff_role_id: string | null;
          p_post_id: string | null;
          p_media_id: string | null;
          p_action: string | null;
        };
        Returns: boolean;
      }
        | {
        Args: {
          p_staff_role_id: string | null;
          p_post_id: string | null;
          p_media_id: string | null;
          p_expected_revision: number | null;
          p_action: string | null;
        };
        Returns: boolean;
      };
      night_signal_independent_corroboration: {
        Args: {
          primary_url: string | null;
          primary_publisher: string | null;
          observed_at: string | null;
          sources: Json;
        };
        Returns: boolean;
      };
      night_signal_iso_timestamp: {
        Args: {
          value: string | null;
        };
        Returns: boolean;
      };
      night_signal_public_url: {
        Args: {
          value: string | null;
        };
        Returns: boolean;
      };
      night_signal_source_host: {
        Args: {
          value: string | null;
        };
        Returns: string;
      };
      open_plan_stop_matches_city: {
        Args: {
          p_venue_id: string | null;
          p_city: string | null;
        };
        Returns: boolean;
      };
      promote_wanted_to_saved_list: {
        Args: {
          p_owner_actor: string | null;
          p_profile_id: string | null;
          p_wanted_id: string | null;
          p_venue_id: string | null;
          p_list_type: string | null;
        };
        Returns: {
          outcome: string;
          promoted_list_type: string;
          promoted_at: string;
        }[];
      };
      provision_social_product_account: {
        Args: {
          p_supabase_user_id: string | null;
        };
        Returns: Json;
      };
      prune_expired_rate_limits: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      public_contributor_leaderboard: {
        Args: Record<PropertyKey, never>;
        Returns: {
          handle: string;
          prices: number;
          reviews: number;
          recommendations: number;
          total: number;
        }[];
      };
      public_withdrawn_profiles: {
        Args: Record<PropertyKey, never>;
        Returns: {
          profile_id: string;
          handle: string;
        }[];
      };
      qualify_referral_from_contribution: {
        Args: {
          p_invitee_user_id: string | null;
          p_contribution_kind: string | null;
          p_contribution_id: string | null;
          p_accepted_at: string | null;
        };
        Returns: Json;
      };
      read_private_referral_status: {
        Args: {
          p_inviter_user_id: string | null;
        };
        Returns: Json;
      };
      read_social_cheers: {
        Args: {
          p_viewer: string | null;
          p_post_id: string | null;
          p_before_created_at: string | null;
          p_before_profile_id: string | null;
          p_limit: number | null;
        };
        Returns: {
          profile_id: string;
          handle: string;
          created_at: string;
        }[];
      };
      read_social_comments: {
        Args: {
          p_viewer: string | null;
          p_post_id: string | null;
          p_before_created_at: string | null;
          p_before_id: string | null;
          p_limit: number | null;
        };
        Returns: Database["public"]["Tables"]["social_comments"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "social_comments";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      read_social_crew_join_requests: {
        Args: {
          p_viewer_account_id: string | null;
          p_viewer_profile_id: string | null;
          p_crew_id: string | null;
        };
        Returns: Json;
      };
      read_social_crew_member_page: {
        Args: {
          p_viewer_account_id: string | null;
          p_viewer_profile_id: string | null;
          p_cursor_joined_at: string | null;
          p_cursor_member_id: string | null;
          p_limit: number | null;
        };
        Returns: Json;
      };
      read_social_crew_public_preview: {
        Args: {
          p_crew_id: string | null;
        };
        Returns: Json;
      };
      read_social_crew_snapshot: {
        Args: {
          p_viewer_account_id: string | null;
          p_viewer_profile_id: string | null;
          p_crew_id: string | null;
        };
        Returns: Json;
      };
      read_social_derivatives: {
        Args: {
          p_viewer: string | null;
          p_before_created_at: string | null;
          p_before_id: string | null;
          p_limit: number | null;
        };
        Returns: {
          id: string;
          kind: string;
          source_post_id: string;
          author_profile_id: string;
          author_handle: string;
          body: string;
          visibility: string;
          created_at: string;
          source_post: Json;
        }[];
      };
      read_social_feature_history: {
        Args: {
          p_viewer: string | null;
          p_post_id: string | null;
          p_before_created_at: string | null;
          p_before_id: string | null;
          p_limit: number | null;
        };
        Returns: {
          id: string;
          status: string;
          response: string;
          created_at: string;
        }[];
      };
      read_social_feature_queue: {
        Args: {
          p_actor: string | null;
          p_before_created_at: string | null;
          p_before_id: string | null;
          p_limit: number | null;
        };
        Returns: Database["public"]["Tables"]["social_posts"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "social_posts";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      read_social_feature_status: {
        Args: {
          p_viewer: string | null;
          p_post_id: string | null;
        };
        Returns: {
          current_status: string;
        }[];
      };
      read_social_interaction_summary: {
        Args: {
          p_viewer: string | null;
          p_post_id: string | null;
        };
        Returns: {
          cheered: boolean;
          saved: boolean;
          reposted: boolean;
          cheer_count: number;
          repost_count: number;
        }[];
      };
      read_social_notifications: {
        Args: {
          p_viewer: string | null;
          p_before_created_at: string | null;
          p_before_id: string | null;
          p_limit: number | null;
        };
        Returns: Database["public"]["Tables"]["social_notifications"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "social_notifications";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      read_social_post: {
        Args: {
          p_post_id: string | null;
          p_viewer_profile_id: string | null;
        };
        Returns: Database["public"]["Tables"]["social_posts"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "social_posts";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      read_social_post_feed: {
        Args: {
          p_viewer_profile_id: string | null;
          p_lane: string | null;
          p_area_slug?: string | null;
          p_before_created_at?: string | null;
          p_before_id?: string | null;
          p_limit?: number | null;
        };
        Returns: Database["public"]["Tables"]["social_posts"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "social_posts";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      read_social_post_media: {
        Args: {
          p_viewer: string | null;
          p_media_id: string | null;
        };
        Returns: {
          object_key: string;
        }[];
      };
      read_social_post_media_admin: {
        Args: {
          p_staff_role_id: string | null;
          p_media_id: string | null;
        };
        Returns: {
          object_key: string;
        }[];
      };
      read_social_post_moderation_queue: {
        Args: {
          p_actor: string | null;
          p_limit?: number | null;
        };
        Returns: {
          staff_display_name: string;
          post_id: string;
          media_id: string;
          moderation_claim: string;
          created_at: string;
        }[];
      };
      read_social_post_moderation_queue_admin: {
        Args: {
          p_staff_role_id: string | null;
          p_limit?: number | null;
        };
        Returns: {
          staff_display_name: string;
          post_id: string;
          media_id: string;
          moderation_claim: string;
          created_at: string;
        }[];
      };
      read_social_post_outbox: {
        Args: {
          p_owner: string | null;
          p_before_created_at?: string | null;
          p_before_id?: string | null;
          p_limit?: number | null;
        };
        Returns: Database["public"]["Tables"]["social_posts"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "social_posts";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      read_social_post_outbox_item: {
        Args: {
          p_post_id: string | null;
          p_owner: string | null;
        };
        Returns: Database["public"]["Tables"]["social_posts"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "social_posts";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      read_social_post_tags: {
        Args: {
          p_viewer: string | null;
          p_post_id: string | null;
        };
        Returns: {
          proposal_id: string;
          handle: string;
        }[];
      };
      read_social_post_tags_many: {
        Args: {
          p_viewer: string | null;
          p_post_ids: string[] | null;
        };
        Returns: {
          post_id: string;
          proposal_id: string;
          handle: string;
        }[];
      };
      read_social_report_queue: {
        Args: {
          p_actor: string | null;
          p_before_created_at: string | null;
          p_before_id: string | null;
          p_limit: number | null;
        };
        Returns: Database["public"]["Tables"]["social_content_reports"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "social_content_reports";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      read_social_saves: {
        Args: {
          p_viewer: string | null;
          p_before_created_at: string | null;
          p_before_post_id: string | null;
          p_limit: number | null;
        };
        Returns: {
          post_id: string;
          saved_at: string;
          source_post: Json;
        }[];
      };
      read_social_tag_inbox: {
        Args: {
          p_viewer: string | null;
          p_lane: string | null;
          p_before_created_at?: string | null;
          p_before_id?: string | null;
          p_limit?: number | null;
        };
        Returns: {
          proposal_id: string;
          post_id: string;
          media_id: string;
          author_handle: string;
          state: string;
          visibility: string;
          photo_alt_text: string;
          audience_visibility: string;
          review_revision: number;
          audience_revision: number;
          audience_shown_at: string;
          created_at: string;
        }[];
      };
      reconcile_round_price_keys: {
        Args: {
          p_spend_id: string | null;
          p_actor: string | null;
        };
        Returns: string;
      };
      record_plan_member_group_pref_atomic: {
        Args: {
          p_plan_id: string | null;
          p_member_id: string | null;
          p_budget_band: string | null;
          p_atmosphere_chip: string | null;
          p_zero_proof: boolean | null;
          p_accessibility_required: boolean | null;
          p_weather_shelter_required: boolean | null;
          p_idempotency_key: string | null;
          p_pref_id: string | null;
          p_created_at: string | null;
        };
        Returns: Json;
      };
      record_plan_vibe_vote_atomic: {
        Args: {
          p_plan_id: string | null;
          p_member_id: string | null;
          p_vibe: string | null;
          p_idempotency_key: string | null;
          p_vote_id: string | null;
          p_created_at: string | null;
        };
        Returns: Json;
      };
      record_plan_vote_atomic: {
        Args: {
          p_plan_id: string | null;
          p_proposal_id: string | null;
          p_member_id: string | null;
          p_value: string | null;
          p_idempotency_key: string | null;
          p_vote_id: string | null;
          p_created_at: string | null;
        };
        Returns: Json;
      };
      record_pub_pal_voice_minutes: {
        Args: {
          p_owner_id: string | null;
          p_month: string | null;
          p_seconds: number | null;
        };
        Returns: boolean;
      };
      record_referral_edge: {
        Args: {
          p_inviter_user_id: string | null;
          p_invitee_user_id: string | null;
          p_attributed_at: string | null;
        };
        Returns: Json;
      };
      recover_plan_account_membership_atomic:
        | {
        Args: {
          p_plan_id: string | null;
          p_user_id: string | null;
          p_member_token_hash: string | null;
          p_idempotency_key_hash: string | null;
          p_request_hash: string | null;
          p_recovered_at: string | null;
        };
        Returns: string;
      }
        | {
        Args: {
          p_plan_id: string | null;
          p_user_id: string | null;
          p_member_token_hash: string | null;
          p_recovered_at: string | null;
        };
        Returns: string;
      };
      redeem_plan_invite_account_idempotent_atomic: {
        Args: {
          p_plan_id: string | null;
          p_invite_token_hash: string | null;
          p_member_id: string | null;
          p_member_name: string | null;
          p_member_token_hash: string | null;
          p_joined_at: string | null;
          p_idempotency_key_hash: string | null;
          p_request_hash: string | null;
          p_user_id: string | null;
        };
        Returns: string;
      };
      redeem_plan_invite_atomic: {
        Args: {
          p_plan_id: string | null;
          p_invite_token_hash: string | null;
          p_member_id: string | null;
          p_member_name: string | null;
          p_member_token_hash: string | null;
          p_joined_at: string | null;
        };
        Returns: string;
      };
      redeem_plan_invite_idempotent_atomic: {
        Args: {
          p_plan_id: string | null;
          p_invite_token_hash: string | null;
          p_member_id: string | null;
          p_member_name: string | null;
          p_member_token_hash: string | null;
          p_joined_at: string | null;
          p_idempotency_key_hash: string | null;
          p_request_hash: string | null;
        };
        Returns: string;
      };
      release_pub_pal_voice_trial: {
        Args: {
          p_owner_id: string | null;
          p_month: string | null;
        };
        Returns: boolean;
      };
      remove_plan_invite_rsvp_membership_atomic: {
        Args: {
          p_plan_id: string | null;
          p_rsvp_id: string | null;
        };
        Returns: string;
      };
      remove_social_crew_member_atomic: {
        Args: {
          p_actor_account_id: string | null;
          p_crew_id: string | null;
          p_target_member_id: string | null;
          p_idempotency_key: string | null;
          p_payload_digest: string | null;
        };
        Returns: Json;
      };
      remove_social_post_idempotent: {
        Args: {
          p_post_id: string | null;
          p_author_profile_id: string | null;
          p_expected_mutation_version: number | null;
          p_idempotency_key: string | null;
        };
        Returns: boolean;
      };
      rename_pubmaxx_handle: {
        Args: {
          p_user_id: string | null;
          p_handle: string | null;
        };
        Returns: Json;
      };
      replace_plan_route_atomic: {
        Args: {
          p_plan_id: string | null;
          p_token_hash: string | null;
          p_expected_route_revision: number | null;
          p_stops: Json;
          p_context: Json;
          p_grounded_upgrade?: boolean | null;
        };
        Returns: string;
      };
      replace_whats_on_listings: {
        Args: {
          p_kind: string | null;
          p_rows: Json;
          p_generated_at: string | null;
        };
        Returns: number;
      };
      report_community_price: {
        Args: {
          p_id: string | null;
          p_actor_hash: string | null;
          p_reason: string | null;
        };
        Returns: boolean;
      };
      report_occupancy_report: {
        Args: {
          p_id: string | null;
          p_actor_hash: string | null;
          p_reason: string | null;
        };
        Returns: boolean;
      };
      report_pint_drop: {
        Args: {
          p_id: string | null;
          p_reason: string | null;
          p_hide_threshold: number | null;
        };
        Returns: number;
      };
      report_pint_drop_anonymous: {
        Args: {
          p_id: string | null;
          p_actor_hash: string | null;
          p_reason: string | null;
        };
        Returns: boolean;
      };
      report_pint_drop_v2: {
        Args: {
          p_id: string | null;
          p_actor_hash: string | null;
          p_reason: string | null;
          p_hide_threshold: number | null;
        };
        Returns: number;
      };
      report_social_content: {
        Args: {
          p_actor: string | null;
          p_kind: string | null;
          p_content_id: string | null;
          p_reason: string | null;
        };
        Returns: Database["public"]["Tables"]["social_content_reports"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "social_content_reports";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      request_social_crew_join_atomic: {
        Args: {
          p_actor_account_id: string | null;
          p_crew_id: string | null;
          p_action: string | null;
          p_idempotency_key: string | null;
          p_payload_digest: string | null;
        };
        Returns: Json;
      };
      requeue_social_post_moderation_errors: {
        Args: {
          p_limit?: number | null;
        };
        Returns: number;
      };
      reserve_social_post_media_upload: {
        Args: {
          p_owner_profile_id: string | null;
          p_media_id: string | null;
          p_sha256: string | null;
          p_width: number | null;
          p_height: number | null;
          p_byte_size: number | null;
        };
        Returns: {
          media_id: string;
          generation: string;
          object_key: string;
        }[];
      };
      resolve_plan_constraint_atomic: {
        Args: {
          p_plan_id: string | null;
          p_constraint_id: string | null;
          p_resolved_by_member_id: string | null;
          p_resolution_evidence: Json;
          p_resolution_idempotency_key: string | null;
          p_resolved_at: string | null;
        };
        Returns: Json;
      };
      resolve_social_report: {
        Args: {
          p_actor: string | null;
          p_report_id: string | null;
        };
        Returns: boolean;
      };
      revoke_plan_invite_atomic: {
        Args: {
          p_plan_id: string | null;
          p_invite_id: string | null;
          p_revoked_at: string | null;
        };
        Returns: Json;
      };
      revoke_social_crew_invitation_atomic: {
        Args: {
          p_actor_account_id: string | null;
          p_crew_id: string | null;
          p_invitation_id: string | null;
          p_idempotency_key: string | null;
          p_payload_digest: string | null;
        };
        Returns: Json;
      };
      set_social_block: {
        Args: {
          p_actor: string | null;
          p_target: string | null;
          p_active: boolean | null;
        };
        Returns: boolean;
      };
      set_social_comment_policy: {
        Args: {
          p_actor: string | null;
          p_post_id: string | null;
          p_policy: string | null;
        };
        Returns: boolean;
      };
      set_social_crew_role_atomic: {
        Args: {
          p_actor_account_id: string | null;
          p_crew_id: string | null;
          p_target_member_id: string | null;
          p_role: string | null;
          p_idempotency_key: string | null;
          p_payload_digest: string | null;
        };
        Returns: Json;
      };
      set_social_desired_interaction: {
        Args: {
          p_actor: string | null;
          p_post_id: string | null;
          p_kind: string | null;
          p_active: boolean | null;
          p_actor_handle?: string | null;
        };
        Returns: boolean;
      };
      social_interaction_blocked: {
        Args: {
          p_first: string | null;
          p_second: string | null;
        };
        Returns: boolean;
      };
      social_post_digest: {
        Args: {
          p_post: Database["public"]["Tables"]["social_posts"]["Row"] | null;
        };
        Returns: string;
      };
      social_post_exact_venue_allowed: {
        Args: {
          p_post: Database["public"]["Tables"]["social_posts"]["Row"] | null;
          p_viewer_profile_id: string | null;
        };
        Returns: boolean;
      };
      social_post_readable: {
        Args: {
          p_post: Database["public"]["Tables"]["social_posts"]["Row"] | null;
          p_viewer_profile_id: string | null;
        };
        Returns: boolean;
      };
      social_relationship_between_profiles: {
        Args: {
          p_first_profile_id: string | null;
          p_second_profile_id: string | null;
        };
        Returns: string;
      };
      transfer_social_crew_owner_atomic: {
        Args: {
          p_actor_account_id: string | null;
          p_crew_id: string | null;
          p_target_member_id: string | null;
          p_idempotency_key: string | null;
          p_payload_digest: string | null;
        };
        Returns: Json;
      };
      transition_round_price_lines: {
        Args: {
          p_spend_id: string | null;
          p_actor: string | null;
          p_updates: Json;
        };
        Returns: string;
      };
      update_legacy_plan_status_context_atomic: {
        Args: {
          p_plan_id: string | null;
          p_token_hash: string | null;
          p_status: string | null;
          p_context: Json;
        };
        Returns: string;
      };
      update_night_story_draft_atomic: {
        Args: {
          p_story_id: string | null;
          p_actor_id: string | null;
          p_title: string | null;
          p_summary: string | null;
          p_updated_at: string | null;
        };
        Returns: boolean;
      };
      update_social_crew_visibility_atomic: {
        Args: {
          p_actor_account_id: string | null;
          p_crew_id: string | null;
          p_visibility: string | null;
          p_expected_authority_revision: number | null;
          p_idempotency_key: string | null;
          p_payload_digest: string | null;
        };
        Returns: Json;
      };
      upgrade_plan_member_invite_atomic: {
        Args: {
          p_plan_id: string | null;
          p_invite_token_hash: string | null;
          p_member_token_hash: string | null;
          p_redeemed_at: string | null;
        };
        Returns: string;
      };
      upsert_attributed_community_price_if_newer: {
        Args: {
          p_venue_id: string | null;
          p_drink_category: string | null;
          p_price_pennies: number | null;
          p_actor: string | null;
          p_contributor_handle: string | null;
          p_submitted_at: string | null;
          p_round_spend_id: string | null;
          p_round_line_index: number | null;
        };
        Returns: {
          id: string;
          price_pennies: number;
          submitted_at: string;
          round_spend_id: string;
          round_line_index: number;
          source_became_owner: boolean;
        }[];
      };
      upsert_plan_invite_rsvp_membership_atomic: {
        Args: {
          p_plan_id: string | null;
          p_submitter_hash: string | null;
          p_display_name: string | null;
          p_status: string | null;
          p_member_id: string | null;
          p_existing_member_id: string | null;
          p_member_name: string | null;
          p_member_token_hash: string | null;
          p_member_join_key_hash: string | null;
          p_member_request_hash: string | null;
          p_joined_at: string | null;
          p_rsvp_ceiling: number | null;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
