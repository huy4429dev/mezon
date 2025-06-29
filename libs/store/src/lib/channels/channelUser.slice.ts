import { captureSentryError } from '@mezon/logger';
import { IChannelUser, LoadingStatus } from '@mezon/utils';
import { EntityState, PayloadAction, createAsyncThunk, createEntityAdapter, createSelector, createSlice } from '@reduxjs/toolkit';
import { ChannelDescription, ChannelType } from 'mezon-js';
import { MezonValueContext, ensureSession, getMezonCtx } from '../helpers';
import { memoizeAndTrack } from '../memoize';

export const LIST_CHANNELS_USER_FEATURE_KEY = 'listchannelbyusers';

/*
 * Update these interfaces according to your requirements.
 */
export interface ChannelUsersEntity extends IChannelUser {
	id: string; // Primary ID
}

export const mapChannelsByUserToEntity = (channelRes: ChannelDescription) => {
	return { ...channelRes, id: channelRes.channel_id || '', status: channelRes.meeting_code ? 1 : 0 };
};

export interface ListChannelsByUserState extends EntityState<ChannelUsersEntity, string> {
	loadingStatus: LoadingStatus;
	error?: string | null;
}

export const listChannelsByUserAdapter = createEntityAdapter<ChannelUsersEntity>();

export interface ListChannelsByUserRootState {
	[LIST_CHANNELS_USER_FEATURE_KEY]: ListChannelsByUserState;
}

export const fetchListChannelsByUserCached = memoizeAndTrack(
	async (mezon: MezonValueContext) => {
		const response = await mezon.client.listChannelByUserId(mezon.session);
		return { ...response, time: Date.now() };
	},
	{
		promise: true,
		maxAge: 1000 * 60 * 60,
		normalizer: (args) => {
			return args[0].session.username || '';
		}
	}
);

type fetchUserChannelsPayload = {
	noCache?: boolean;
	isClearChannel?: boolean;
};

type FetchMessagesPayloadAction = {
	channels: ChannelUsersEntity[];
	isClearChannel?: boolean;
};

export const fetchListChannelsByUser = createAsyncThunk<{ channels: ChannelUsersEntity[]; isClearChannel: boolean }, fetchUserChannelsPayload>(
	'channelsByUser/fetchListChannelsByUser',
	async ({ noCache = false, isClearChannel = false }: fetchUserChannelsPayload, thunkAPI) => {
		try {
			const mezon = await ensureSession(getMezonCtx(thunkAPI));
			if (noCache) {
				fetchListChannelsByUserCached.delete(mezon);
			}
			const response = await fetchListChannelsByUserCached(mezon);
			if (!response?.channeldesc) {
				return { channels: [], isClearChannel };
			}

			const channels = response.channeldesc.map(mapChannelsByUserToEntity);

			return { channels, isClearChannel };
		} catch (error) {
			captureSentryError(error, 'channelsByUser/fetchListChannelsByUser');
			return thunkAPI.rejectWithValue(error);
		}
	}
);

export const initialListChannelsByUserState: ListChannelsByUserState = listChannelsByUserAdapter.getInitialState({
	loadingStatus: 'not loaded',
	error: null
});

export const listChannelsByUserSlice = createSlice({
	name: LIST_CHANNELS_USER_FEATURE_KEY,
	initialState: initialListChannelsByUserState,
	reducers: {
		add: listChannelsByUserAdapter.addOne,
		removeAll: listChannelsByUserAdapter.removeAll,
		remove: listChannelsByUserAdapter.removeOne,
		update: listChannelsByUserAdapter.updateOne,
		upsertOne: listChannelsByUserAdapter.upsertOne,
		removeByClanId: (state, action: PayloadAction<{ clanId: string }>) => {
			const channels = listChannelsByUserAdapter.getSelectors().selectAll(state);
			const channelsToRemove = channels.filter((channel) => channel.clan_id === action.payload.clanId).map((channel) => channel.id);
			listChannelsByUserAdapter.removeMany(state, channelsToRemove);
		},
		updateLastSentTime: (state, action: PayloadAction<{ channelId: string }>) => {
			const payload = action.payload;
			const timestamp = Date.now() / 1000;
			listChannelsByUserAdapter.updateOne(state, {
				id: payload.channelId,
				changes: {
					last_sent_message: {
						timestamp_seconds: timestamp
					}
				}
			});
		},
		updateLastSeenTime: (state, action: PayloadAction<{ channelId: string }>) => {
			const payload = action.payload;
			const timestamp = Date.now() / 1000;
			listChannelsByUserAdapter.updateOne(state, {
				id: payload.channelId,
				changes: {
					last_seen_message: {
						timestamp_seconds: timestamp
					}
				}
			});
		},
		resetBadgeCount: (state, action: PayloadAction<{ channelId: string }>) => {
			const payload = action.payload;
			const existingChannel = listChannelsByUserAdapter.getSelectors().selectById(state, payload.channelId);

			if (existingChannel && existingChannel.count_mess_unread !== undefined) {
				listChannelsByUserAdapter.updateOne(state, {
					id: payload.channelId,
					changes: {
						count_mess_unread: undefined
					}
				});
			}
		},
		updateChannelBadgeCount: (state: ListChannelsByUserState, action: PayloadAction<{ channelId: string; count: number; isReset?: boolean }>) => {
			const { channelId, count, isReset = false } = action.payload;
			if (state.entities) {
				const entity = state.entities[channelId];
				if (entity) {
					const newCountMessUnread = isReset ? 0 : (entity.count_mess_unread ?? 0) + count;
					if (entity.count_mess_unread !== newCountMessUnread || isReset) {
						const last_sent_message = state.entities[state.ids[state.ids.length - 1]].last_sent_message;

						listChannelsByUserAdapter.updateOne(state, {
							id: channelId,
							changes: {
								count_mess_unread: newCountMessUnread,
								last_seen_message:
									newCountMessUnread === 0
										? {
												id: last_sent_message?.id,
												timestamp_seconds: Date.now()
											}
										: entity.last_seen_message
							}
						});
					}
				}
			}
		},
		addOneChannel: (state, action: PayloadAction<ChannelUsersEntity>) => {
			listChannelsByUserAdapter.addOne(state, action.payload);
		},
		markAsReadChannel: (state, action: PayloadAction<string[]>) => {
			const updateList = action.payload.map((id) => {
				const last_sent_message = state.entities[id]?.last_sent_message;
				return {
					id: id,
					changes: {
						count_mess_unread: 0,
						last_seen_message: {
							id: last_sent_message?.id,
							timestamp_seconds: Date.now()
						}
					}
				};
			});
			listChannelsByUserAdapter.updateMany(state, updateList);
		}
	},
	extraReducers: (builder) => {
		builder
			.addCase(fetchListChannelsByUser.pending, (state: ListChannelsByUserState) => {
				state.loadingStatus = 'loading';
			})
			.addCase(fetchListChannelsByUser.fulfilled, (state: ListChannelsByUserState, action: PayloadAction<FetchMessagesPayloadAction>) => {
				const channels = action?.payload?.channels;
				const isClearChannel = action?.payload?.isClearChannel || false;
				if (isClearChannel) {
					listChannelsByUserAdapter.setAll(state, channels);
				} else {
					listChannelsByUserAdapter.upsertMany(state, channels);
				}
				state.loadingStatus = 'loaded';
			})
			.addCase(fetchListChannelsByUser.rejected, (state: ListChannelsByUserState, action) => {
				state.loadingStatus = 'error';
				state.error = action.error.message;
			});
	}
});

/*
 * Export reducer for store configuration.
 */
export const listchannelsByUserReducer = listChannelsByUserSlice.reducer;

/*
 * Export action creators to be dispatched. For use with the `useDispatch` hook.
 *
 * e.g.
 * ```
 * import React, { useEffect } from 'react';
 * import { useDispatch } from 'react-redux';
 *
 * // ...
 *
 * const dispatch = useDispatch();
 * useEffect(() => {
 *   dispatch(channelsActions.add({ id: 1 }))
 * }, [dispatch]);
 * ```
 *
 * See: https://react-redux.js.org/next/api/hooks#usedispatch
 */

export const listChannelsByUserActions = {
	...listChannelsByUserSlice.actions,
	fetchListChannelsByUser
};

/*
 * Export selectors to query state. For use with the `useSelector` hook.
 *
 * e.g.
 * ```
 * import { useSelector } from 'react-redux';
import { channel } from 'process';
import { mess } from '@mezon/store';
 *
 * // ...
 *
 * const entities = useSelector(selectAllChannels);
 * ```
 *
 * See: https://react-redux.js.org/next/api/hooks#useselector
 */
const { selectAll, selectEntities } = listChannelsByUserAdapter.getSelectors();

export const getChannelsByUserState = (rootState: { [LIST_CHANNELS_USER_FEATURE_KEY]: ListChannelsByUserState }): ListChannelsByUserState =>
	rootState[LIST_CHANNELS_USER_FEATURE_KEY];

export const selectAllChannelsByUser = createSelector(getChannelsByUserState, selectAll);
export const selectEntitiesChannelsByUser = createSelector(getChannelsByUserState, selectEntities);

export const selectGmeetVoice = createSelector(selectAllChannelsByUser, (hashtags) =>
	hashtags.filter((hashtag) => hashtag.type === ChannelType.CHANNEL_TYPE_GMEET_VOICE)
);

export const selectAllInfoChannels = createSelector(selectAllChannelsByUser, (channels = []) =>
	channels?.map(({ channel_id, channel_label, channel_private, clan_name, clan_id, type, parent_id, meeting_code, id }) => ({
		channel_id,
		channel_label,
		channel_private,
		clan_name,
		clan_id,
		type,
		parent_id,
		meeting_code,
		id
	}))
);
