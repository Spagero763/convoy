//! Test doubles. Not deployed.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IMockERC20<T> {
    fn mint(ref self: T, to: ContractAddress, amount: u256);
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn allowance(self: @T, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: T, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
}

#[starknet::contract]
pub mod MockERC20 {
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
        total_supply: u256,
    }

    #[abi(embed_v0)]
    impl MockERC20Impl of super::IMockERC20<ContractState> {
        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            self.balances.write(to, self.balances.read(to) + amount);
            self.total_supply.write(self.total_supply.read() + amount);
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.read((owner, spender))
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let from = get_caller_address();
            let balance = self.balances.read(from);
            assert(balance >= amount, 'ERC20_INSUFFICIENT');
            self.balances.write(from, balance - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let spender = get_caller_address();
            let allowed = self.allowances.read((sender, spender));
            assert(allowed >= amount, 'ERC20_INSUFFICIENT_ALLOWANCE');
            let balance = self.balances.read(sender);
            assert(balance >= amount, 'ERC20_INSUFFICIENT');
            self.allowances.write((sender, spender), allowed - amount);
            self.balances.write(sender, balance - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            true
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            self.allowances.write((get_caller_address(), spender), amount);
            true
        }
    }
}

#[starknet::interface]
pub trait IMockRouterAdmin<T> {
    /// Output produced per unit of input, as `num / den`.
    fn set_rate(ref self: T, num: u128, den: u128);
    /// Input left unswapped on the router, to simulate a partial fill.
    fn set_leftover(ref self: T, leftover: u128);
    fn set_out_token(ref self: T, token: ContractAddress);
}

/// Stands in for the Ekubo router: accepts input, then hands back leftover input
/// through `clear` and output through `clear_minimum`, the same two-step shape
/// the real router uses.
#[starknet::contract]
pub mod MockRouter {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use convoy::external::{Delta, IClear, IRouter, RouteNode, TokenAmount, i129};
    use super::{IMockERC20Dispatcher, IMockERC20DispatcherTrait};

    #[storage]
    struct Storage {
        rate_num: u128,
        rate_den: u128,
        leftover: u128,
        out_token: ContractAddress,
        last_in_token: ContractAddress,
        last_in_amount: u128,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {
        self.rate_num.write(1);
        self.rate_den.write(1);
    }

    #[abi(embed_v0)]
    impl AdminImpl of super::IMockRouterAdmin<ContractState> {
        fn set_rate(ref self: ContractState, num: u128, den: u128) {
            self.rate_num.write(num);
            self.rate_den.write(den);
        }

        fn set_leftover(ref self: ContractState, leftover: u128) {
            self.leftover.write(leftover);
        }

        fn set_out_token(ref self: ContractState, token: ContractAddress) {
            self.out_token.write(token);
        }
    }

    #[abi(embed_v0)]
    impl RouterImpl of IRouter<ContractState> {
        fn swap(
            ref self: ContractState, node: RouteNode, token_amount: TokenAmount,
        ) -> Delta {
            self.last_in_token.write(token_amount.token);
            self.last_in_amount.write(token_amount.amount.mag);
            Delta {
                amount0: i129 { mag: 0, sign: false }, amount1: i129 { mag: 0, sign: false },
            }
        }
    }

    #[abi(embed_v0)]
    impl ClearImpl of IClear<ContractState> {
        fn clear(self: @ContractState, token: ContractAddress) -> u256 {
            let leftover = self.leftover.read();
            if leftover != 0 {
                IMockERC20Dispatcher { contract_address: token }
                    .transfer(get_caller_address(), leftover.into());
            }
            leftover.into()
        }

        fn clear_minimum(self: @ContractState, token: ContractAddress, minimum: u256) -> u256 {
            let gross = self.last_in_amount.read() - self.leftover.read();
            let out: u256 = (gross.into() * self.rate_num.read().into())
                / self.rate_den.read().into();
            assert(out >= minimum, 'CLEAR_AT_LEAST_MINIMUM');
            let erc20 = IMockERC20Dispatcher { contract_address: token };
            assert(erc20.balance_of(get_contract_address()) >= out, 'MOCK_ROUTER_DRY');
            erc20.transfer(get_caller_address(), out);
            out
        }
    }
}
