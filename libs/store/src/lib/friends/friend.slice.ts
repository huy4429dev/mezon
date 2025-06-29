/* eslint-disable prefer-const */
// eslint-disable-next-line @nx/enforce-module-boundaries
import { selectCurrentUserId } from '@mezon/store';
import { LoadingStatus } from '@mezon/utils';
import { EntityState, PayloadAction, createAsyncThunk, createEntityAdapter, createSelector, createSlice } from '@reduxjs/toolkit';
import { Friend } from 'mezon-js';
import { toast } from 'react-toastify';
import { StatusUserArgs } from '../channelmembers/channel.members';
import { MezonValueContext, ensureSession, getMezonCtx } from '../helpers';
import { memoizeAndTrack } from '../memoize';

export const FRIEND_FEATURE_KEY = 'friends';
const LIST_FRIEND_CACHED_TIME = 1000 * 60 * 60;
const LIMIT_FRIEND = 1000;

export interface FriendsEntity extends Friend {
	key: string;
	id: string;
}

export interface IFriend extends Friend {
	key: string;
	id: string;
}

interface IStatusSentMobile {
	isSuccess: boolean;
}

export enum EStateFriend {
	FRIEND = 0,
	OTHER_PENDING = 1,
	MY_PENDING = 2,
	BLOCK = 3
}

export const mapFriendToEntity = (FriendRes: Friend) => {
	const uniqueId = `${FriendRes?.user?.id}_${FriendRes?.source_id}`;
	return {
		...FriendRes,
		key: uniqueId,
		id: FriendRes?.user?.id || '',
		source_id: FriendRes?.source_id || ''
	};
};
export interface FriendsState extends EntityState<FriendsEntity, string> {
	loadingStatus: LoadingStatus;
	error?: string | null;
	currentTabStatus: string;
	statusSentMobile: IStatusSentMobile | null;
}

export const friendsAdapter = createEntityAdapter({
	selectId: (friend: FriendsEntity) => friend.key || ''
});

export const fetchListFriendsCached = memoizeAndTrack(
	(mezon: MezonValueContext, state: number, limit: number, cursor: string) =>
		mezon.client.listFriends(mezon.session, state === -1 ? undefined : state, limit, cursor),
	{
		promise: true,
		maxAge: LIST_FRIEND_CACHED_TIME,
		normalizer: (args) => {
			return args[1] + args[2] + args[3] + args[0].session.username;
		}
	}
);

type fetchListFriendsArgs = {
	noCache?: boolean;
};

export const fetchListFriends = createAsyncThunk('friends/fetchListFriends', async ({ noCache }: fetchListFriendsArgs, thunkAPI) => {
	const mezon = await ensureSession(getMezonCtx(thunkAPI));
	if (noCache) {
		fetchListFriendsCached.delete(mezon, -1, LIMIT_FRIEND, '');
	}
	const response = await fetchListFriendsCached(mezon, -1, LIMIT_FRIEND, '');
	if (!response.friends) {
		return [];
	}
	const listFriends = response.friends.map(mapFriendToEntity);
	return listFriends;
});

export type requestAddFriendParam = {
	ids?: string[];
	usernames?: string[];
};

export const sendRequestAddFriend = createAsyncThunk('friends/requestFriends', async ({ ids, usernames }: requestAddFriendParam, thunkAPI) => {
	const mezon = await ensureSession(getMezonCtx(thunkAPI));
	await mezon.client
		.addFriends(mezon.session, ids, usernames)
		.catch(function (err) {
			err.json().then((data: any) => {
				thunkAPI.dispatch(
					friendsActions.setSentStatusMobile({
						isSuccess: false
					})
				);
				toast.error(data.message);
			});
		})
		.then((data) => {
			if (data) {
				thunkAPI.dispatch(
					friendsActions.setSentStatusMobile({
						isSuccess: true
					})
				);
				thunkAPI.dispatch(friendsActions.fetchListFriends({ noCache: true }));
			}
		});
});

export const sendRequestDeleteFriend = createAsyncThunk(
	'friends/requestDeleteFriends',
	async ({ ids, usernames }: requestAddFriendParam, thunkAPI) => {
		const mezon = await ensureSession(getMezonCtx(thunkAPI));
		const response = await mezon.client.deleteFriends(mezon.session, ids, usernames);
		if (!response) {
			return thunkAPI.rejectWithValue([]);
		}
		thunkAPI.dispatch(friendsActions.fetchListFriends({ noCache: true }));
		return response;
	}
);

export const sendRequestBlockFriend = createAsyncThunk('friends/requestBlockFriends', async ({ ids, usernames }: requestAddFriendParam, thunkAPI) => {
	const mezon = await ensureSession(getMezonCtx(thunkAPI));
	const response = await mezon.client.blockFriends(mezon.session, ids, usernames);
	if (!response) {
		return thunkAPI.rejectWithValue([]);
	}
	return response;
});

export const initialFriendsState: FriendsState = friendsAdapter.getInitialState({
	loadingStatus: 'not loaded',
	friends: [],
	error: null,
	currentTabStatus: 'all',
	statusSentMobile: null
});

export const friendsSlice = createSlice({
	name: FRIEND_FEATURE_KEY,
	initialState: initialFriendsState,
	reducers: {
		remove: (state, action: PayloadAction<string>) => {
			const keyToRemove = state?.ids?.find((key) => state?.entities?.[key]?.user?.id === action.payload);
			keyToRemove && friendsAdapter.removeOne(state, keyToRemove);
		},
		changeCurrentStatusTab: (state, action: PayloadAction<string>) => {
			state.currentTabStatus = action.payload;
		},
		setSentStatusMobile: (state, action: PayloadAction<IStatusSentMobile | null>) => {
			state.statusSentMobile = action.payload;
		},
		setManyStatusUser: (state, action: PayloadAction<StatusUserArgs[]>) => {
			action.payload.forEach((statusUser) => {
				const key = state?.ids?.find((key) => state?.entities?.[key]?.user?.id === statusUser.userId);
				const friend = key ? state?.entities?.[key] : null;
				if (friend?.user && statusUser) {
					friend.user.online = statusUser.online;
					friend.user.is_mobile = statusUser.isMobile;
				}
			});
		},
		updateUserStatus: (state, action: PayloadAction<{ userId: string; user_status: any }>) => {
			const { userId, user_status } = action.payload;
			const key = state?.ids?.find((key) => state?.entities?.[key]?.user?.id === userId);
			const friendMeta = key ? state?.entities?.[key] : null;
			if (friendMeta) {
				friendMeta.user = friendMeta.user || {};
				friendMeta.user.metadata = friendMeta.user.metadata || {};
				//TODO: thai fix later
				(friendMeta.user.metadata as any).user_status = user_status;
			}
		},
		updateFriendState: (
			state,
			action: PayloadAction<{
				userId: string;
				friendState: EStateFriend;
				sourceId?: string;
			}>
		) => {
			const { userId, friendState, sourceId } = action.payload;
			const key = state?.ids?.find((key) => {
				return state?.entities?.[key]?.source_id === userId || state?.entities?.[key]?.user?.id === userId;
			});
			const friend = key ? state?.entities?.[key] : null;

			if (friend) {
				friend.state = friendState;
				if (sourceId) {
					friend.source_id = sourceId;
				}
			}
		}
	},
	extraReducers: (builder) => {
		builder
			.addCase(fetchListFriends.pending, (state: FriendsState) => {
				state.loadingStatus = 'loading';
			})
			.addCase(fetchListFriends.fulfilled, (state: FriendsState, action: PayloadAction<IFriend[]>) => {
				friendsAdapter.setAll(state, action.payload);
				state.loadingStatus = 'loaded';
			})
			.addCase(fetchListFriends.rejected, (state: FriendsState, action) => {
				state.loadingStatus = 'error';
				state.error = action.error.message;
			});
		builder.addCase(sendRequestAddFriend.rejected, (state: FriendsState, action) => {
			state.loadingStatus = 'error';
			state.error = action.error.message ?? 'No valid ID or username was provided.';
		});
	}
});

export const friendsReducer = friendsSlice.reducer;

export const friendsActions = {
	...friendsSlice.actions,
	fetchListFriends,
	sendRequestAddFriend,
	sendRequestDeleteFriend,
	sendRequestBlockFriend
};

const { selectAll } = friendsAdapter.getSelectors();

export const getFriendsState = (rootState: { [FRIEND_FEATURE_KEY]: FriendsState }): FriendsState => rootState[FRIEND_FEATURE_KEY];
export const selectAllFriends = createSelector(getFriendsState, selectAll);
export const selectStatusSentMobile = createSelector(getFriendsState, (state) => state.statusSentMobile);
export const selectFriendStatus = (userId: string) =>
	createSelector(getFriendsState, (state) => {
		const friends = selectAll(state);
		const friend = friends?.find((friend) => friend?.user?.id === userId);
		return friend?.state;
	});
export const selectBlockedUsers = createSelector([selectAllFriends, selectCurrentUserId], (friends, currentUserId) =>
	friends.filter((friend) => friend?.state === EStateFriend.BLOCK && friend?.user?.id !== currentUserId && friend?.source_id === currentUserId)
);
export const selectBlockedUsersForMessage = createSelector([selectAllFriends], (friends) =>
	friends.filter((friend) => friend?.state === EStateFriend.BLOCK)
);
export const selectFriendById = createSelector([selectAllFriends, (state, userId: string) => userId], (friends, userId) =>
	friends.find((friend) => friend?.user?.id === userId || friend?.source_id === userId)
);
export const selectCurrentTabStatus = createSelector(getFriendsState, (state) => state.currentTabStatus);
