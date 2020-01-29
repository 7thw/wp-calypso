/**
 * @jest-environment jsdom
 */

/**
 * External dependencies
 */
import React from 'react';
import { shallow } from 'enzyme';
import { identity } from 'lodash';

/**
 * Internal dependencies
 */
import { Checkout } from '../';
import { hasPendingPayment } from 'lib/cart-values';
import { isEnabled } from 'config';
import '@testing-library/jest-dom/extend-expect';
import { render } from '@testing-library/react';
import { act } from 'react-dom/test-utils';

jest.mock( 'lib/transaction/actions', () => ( {
	resetTransaction: jest.fn(),
} ) );
jest.mock( 'lib/signup/step-actions', () => ( {} ) );
jest.mock( 'lib/analytics', () => ( {
	tracks: {
		recordEvent: jest.fn(),
	},
} ) );
jest.mock( 'lib/analytics/ad-tracking', () => ( {
	recordViewCheckout: jest.fn(),
} ) );
jest.mock( 'page', () => ( {
	redirect: jest.fn(),
} ) );
jest.mock( 'lib/abtest', () => ( {
	abtest() {},
	getABTestVariation() {},
} ) );
jest.mock( 'lib/abtest/active-tests', () => ( {} ) );
jest.mock( 'lib/cart-values', () => ( {
	cartItems: {
		getAll: jest.fn( false ),
		hasFreeTrial: jest.fn( false ),
		hasGoogleApps: jest.fn( false ),
		hasDomainRegistration: jest.fn( false ),
		hasRenewalItem: jest.fn( false ),
		hasOnlyRenewalItems: jest.fn( false ),
		hasTransferProduct: jest.fn( false ),
	},
	isPaymentMethodEnabled: jest.fn( false ),
	paymentMethodName: jest.fn( false ),
	getEnabledPaymentMethods: jest.fn( false ),
	hasPendingPayment: jest.fn(),
} ) );

jest.mock( 'config', () => {
	const mock = () => 'development';
	mock.isEnabled = jest.fn();
	return mock;
} );

//jsdom doesn't properly mock scrollTo
global.scrollTo = () => {};

describe( 'Checkout', () => {
	const defaultProps = {
		cards: [],
		cart: {
			products: [],
		},
		translate: identity,
		loadTrackingTool: identity,
		transaction: {
			step: {},
		},
		setHeaderText: identity,
		clearPurchases: identity,
		fetchReceiptCompleted: identity,
	};

	beforeAll( () => {
		global.window = {
			scrollTo: identity,
			document: {
				documentElement: {},
			},
		};
	} );

	test( 'should render and not blow up', () => {
		const checkout = shallow( <Checkout { ...defaultProps } /> );
		expect( checkout.find( '.checkout' ) ).toHaveLength( 1 );
	} );

	test( 'should set state.cartSettled to false', () => {
		let checkout;

		checkout = shallow(
			<Checkout { ...defaultProps } cart={ { hasLoadedFromServer: false, products: [] } } />
		);
		expect( checkout.state().cartSettled ).toBe( false );

		checkout = shallow(
			<Checkout { ...defaultProps } cart={ { hasLoadedFromServer: true, products: [] } } />
		);
		expect( checkout.state().cartSettled ).toBe( false );
	} );

	test( 'should set state.cartSettled to true after cart has loaded', () => {
		const checkout = shallow(
			<Checkout { ...defaultProps } cart={ { hasLoadedFromServer: false, products: [] } } />
		);
		expect( checkout.state().cartSettled ).toBe( false );

		checkout.setProps( { cart: { hasLoadedFromServer: true, products: [] } } );
		expect( checkout.state().cartSettled ).toBe( true );
	} );

	test( 'should keep state.cartSettled as true even after cart reloads', () => {
		const checkout = shallow(
			<Checkout { ...defaultProps } cart={ { hasLoadedFromServer: false, products: [] } } />
		);
		expect( checkout.state().cartSettled ).toBe( false );

		checkout.setProps( { cart: { hasLoadedFromServer: true, products: [] } } );
		expect( checkout.state().cartSettled ).toBe( true );

		checkout.setProps( { cart: { hasLoadedFromServer: false, products: [] } } );
		expect( checkout.state().cartSettled ).toBe( true );
	} );

	test( 'checkout blocked on pending payment', () => {
		isEnabled.mockImplementation( flag => flag === 'async-payments' );
		hasPendingPayment.mockImplementation( cart => cart && cart.has_pending_payment );

		const wrapper = shallow( <Checkout { ...defaultProps } /> );

		// Need to generate a prop update in order to set cartSettled correctly.
		// cartSettled isn't derived from props on init so setting the cart above
		// does nothing.
		wrapper.setProps( {
			cart: { hasLoadedFromServer: true, products: [], has_pending_payment: true },
		} );

		expect( wrapper.find( 'Localized(PendingPaymentBlocker)' ) ).toHaveLength( 1 );
	} );

	describe( 'provides a handleCheckoutCompleteRedirect function to its children that', () => {
		let container;
		const Redirector = ( { handleCheckoutCompleteRedirect } ) => {
			handleCheckoutCompleteRedirect();
			return null;
		};

		beforeEach( () => {
			container = document.createElement( 'div' );
			document.body.appendChild( container );
		} );

		afterEach( () => {
			document.body.removeChild( container );
		} );

		it( 'redirects to the root page when no site is set', async () => {
			const performRedirectTo = jest.fn();
			await act( async () => {
				render(
					<Checkout { ...defaultProps } performRedirectTo={ performRedirectTo }>
						<Redirector />
					</Checkout>,
					container
				);
			} );
			expect( performRedirectTo ).toHaveBeenCalledWith( '/' );
		} );

		it( 'redirects to the thank-you page with a purchase id when a site and purchaseId is set', async () => {
			const performRedirectTo = jest.fn();
			await act( async () => {
				render(
					<Checkout
						{ ...defaultProps }
						selectedSiteSlug={ 'foo.bar' }
						purchaseId={ '1234abcd' }
						performRedirectTo={ performRedirectTo }
					>
						<Redirector />
					</Checkout>,
					container
				);
			} );
			expect( performRedirectTo ).toHaveBeenCalledWith( '/checkout/thank-you/foo.bar/1234abcd' );
		} );

		it( 'redirects to the thank-you page with a receipt id when a site and transaction receipt_id is set', async () => {
			const performRedirectTo = jest.fn();
			const transaction = {
				step: { data: { receipt_id: '1234abcd', purchases: {}, failed_purchases: {} } },
			};
			await act( async () => {
				render(
					<Checkout
						{ ...defaultProps }
						selectedSiteSlug={ 'foo.bar' }
						transaction={ transaction }
						performRedirectTo={ performRedirectTo }
					>
						<Redirector />
					</Checkout>,
					container
				);
			} );
			expect( performRedirectTo ).toHaveBeenCalledWith( '/checkout/thank-you/foo.bar/1234abcd' );
		} );

		it( 'redirects to the thank-you page with a order id when a site and transaction orderId is set', async () => {
			const performRedirectTo = jest.fn();
			const transaction = {
				step: { data: { orderId: '1234abcd', purchases: {}, failed_purchases: {} } },
			};
			await act( async () => {
				render(
					<Checkout
						{ ...defaultProps }
						selectedSiteSlug={ 'foo.bar' }
						transaction={ transaction }
						performRedirectTo={ performRedirectTo }
					>
						<Redirector />
					</Checkout>,
					container
				);
			} );
			expect( performRedirectTo ).toHaveBeenCalledWith( '/checkout/thank-you/foo.bar/1234abcd' );
		} );

		it( 'redirects to the thank-you page with a placeholder receiptId with a site when the cart is not empty but there is no receipt id', async () => {
			const performRedirectTo = jest.fn();
			const cart = { products: [ { id: 'something' } ] };
			await act( async () => {
				render(
					<Checkout
						{ ...defaultProps }
						selectedSiteSlug={ 'foo.bar' }
						cart={ cart }
						performRedirectTo={ performRedirectTo }
					>
						<Redirector />
					</Checkout>,
					container
				);
			} );
			expect( performRedirectTo ).toHaveBeenCalledWith( '/checkout/thank-you/foo.bar/:receiptId' );
		} );
	} );
} );
