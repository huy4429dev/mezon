/* eslint-disable @nx/enforce-module-boundaries */
import {
	ChannelMembersEntity,
	selectAllChannelMembers,
	selectAllRolesClan,
	selectChannelById,
	selectRolesByChannelId,
	useAppSelector
} from '@mezon/store-mobile';
import { EVERYONE_ROLE_ID, ID_MENTION_HERE, MentionDataProps, getNameForPrioritize } from '@mezon/utils';
import { ChannelStreamMode } from 'mezon-js';
import { ApiRole } from 'mezon-js/api.gen';
import { useMemo } from 'react';
import { useSelector } from 'react-redux';

interface UserMentionListProps {
	channelID: string;
	channelMode?: number;
}

function UseMentionList({ channelID, channelMode }: UserMentionListProps): MentionDataProps[] {
	const channel = useAppSelector((state) => selectChannelById(state, channelID || ''));
	const membersOfParent = useAppSelector((state) => selectAllChannelMembers(state, channelID));
	const channelparent = useAppSelector((state) => selectChannelById(state, channel?.parent_id || ''));
	const rolesChannel = useSelector(selectRolesByChannelId(channel?.parent_id));
	const rolesInClan = useSelector(selectAllRolesClan);

	const rolesToUse = useMemo(() => {
		if (channel?.parent_id !== '0' && channelparent?.channel_private === 1) {
			return rolesChannel;
		} else {
			return rolesInClan;
		}
	}, [channel?.parent_id, channelparent?.channel_private, rolesChannel, rolesInClan]);

	const filteredRoles = useMemo(() => {
		return rolesToUse.filter((role) => role.id !== EVERYONE_ROLE_ID);
	}, [rolesToUse]);
	const newUserMentionList = useMemo(() => {
		const userMentionRaw = membersOfParent;
		const mentionList =
			userMentionRaw?.map((item: ChannelMembersEntity) => ({
				id: item?.id ?? '',
				display: getNameForPrioritize(item.clan_nick ?? '', item.user?.display_name ?? '', item.user?.username ?? ''),
				avatarUrl: item.clan_avatar ? item.clan_avatar : (item?.user?.avatar_url ?? ''),
				username: item.user?.username
			})) ?? [];
		const hardcodedUser: MentionDataProps = {
			id: ID_MENTION_HERE,
			display: 'here',
			avatarUrl: '',
			username: 'here'
		};
		const sortedMentionList = [...mentionList].sort((a, b) => {
			const displayA = a.display?.toLowerCase() || '';
			const displayB = b.display?.toLowerCase() || '';

			if (displayA < displayB) return -1;
			if (displayA > displayB) return 1;
			return 0;
		});
		const roleMentions =
			filteredRoles?.map((item: ApiRole) => ({
				id: item.id ?? '',
				display: item?.title,
				avatarUrl: '',
				clanNick: item?.title,
				isRoleUser: true,
				color: item?.color
			})) ?? [];

		if (channelMode === ChannelStreamMode.STREAM_MODE_CHANNEL || channelMode === ChannelStreamMode.STREAM_MODE_THREAD) {
			return [...sortedMentionList, ...roleMentions, hardcodedUser];
		} else if (channelMode === ChannelStreamMode.STREAM_MODE_GROUP) {
			return [...sortedMentionList, hardcodedUser];
		} else {
			return [...sortedMentionList];
		}
	}, [channelMode, filteredRoles, membersOfParent]);

	return newUserMentionList;
}

export default UseMentionList;
