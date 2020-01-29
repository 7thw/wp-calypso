/**
 * External dependencies
 */
import page from 'page';
import wp from 'lib/wp';
import React, { useMemo, useEffect, useState, useCallback } from 'react';
import { useTranslate } from 'i18n-calypso';
import PropTypes from 'prop-types';
import debugFactory from 'debug';
import { useSelector, useDispatch } from 'react-redux';
import {
	WPCheckout,
	WPCheckoutErrorBoundary,
	useWpcomStore,
	useShoppingCart,
	FormFieldAnnotation,
} from '@automattic/composite-checkout-wpcom';
import { CheckoutProvider, createRegistry } from '@automattic/composite-checkout';
import { Card } from '@automattic/components';

/**
 * Internal dependencies
 */
import {
	conciergeSessionItem,
	domainMapping,
	planItem,
	themeItem,
	jetpackProductItem,
} from 'lib/cart-values/cart-items';
import { requestPlans } from 'state/plans/actions';
import { getPlanBySlug } from 'state/plans/selectors';
import { createPaymentMethods, useStoredCards } from './composite-checkout-payment-methods';
import notices from 'notices';
import getUpgradePlanSlugFromPath from 'state/selectors/get-upgrade-plan-slug-from-path';
import { isJetpackSite } from 'state/sites/selectors';
import isAtomicSite from 'state/selectors/is-site-automated-transfer';
import { FormCountrySelect } from 'components/forms/form-country-select';
import getCountries from 'state/selectors/get-countries';
import { fetchPaymentCountries } from 'state/countries/actions';
import { StateSelect } from 'my-sites/domains/components/form';
import ContactDetailsFormFields from 'components/domains/contact-details-form-fields';
import { getPlan, findPlansKeys } from 'lib/plans';
import { GROUP_WPCOM, TERM_ANNUALLY, TERM_BIENNIALLY, TERM_MONTHLY } from 'lib/plans/constants';
import { computeProductsWithPrices } from 'state/products-list/selectors';
import { requestProductsList } from 'state/products-list/actions';

const debug = debugFactory( 'calypso:composite-checkout' );

const registry = createRegistry();
const { select } = registry;

const wpcom = wp.undocumented();

// Aliasing wpcom functions explicitly bound to wpcom is required here;
// otherwise we get `this is not defined` errors.
const wpcomGetCart = ( ...args ) => wpcom.getCart( ...args );
const wpcomSetCart = ( ...args ) => wpcom.setCart( ...args );
const wpcomGetStoredCards = ( ...args ) => wpcom.getStoredCards( ...args );
const wpcomValidateDomainContactInformation = ( ...args ) =>
	wpcom.validateDomainContactInformation( ...args );

export default function CompositeCheckout( {
	siteSlug,
	siteId,
	product,
	getCart,
	setCart,
	getStoredCards,
	validateDomainContactDetails,
	allowedPaymentMethods,
	overrideCountryList,
	// TODO: handle these also
	// purchaseId,
	// couponCode,
} ) {
	const translate = useTranslate();
	const planSlug = useSelector( state => getUpgradePlanSlugFromPath( state, siteId, product ) );
	const isJetpackNotAtomic = useSelector(
		state => isJetpackSite( state, siteId ) && ! isAtomicSite( state, siteId )
	);

	const onPaymentComplete = useCallback( () => {
		debug( 'payment completed successfully' );
		// TODO: determine which thank-you page to visit
		page.redirect( `/checkout/thank-you/${ siteId || '' }/` );
	}, [ siteId ] );

	const showErrorMessage = useCallback(
		error => {
			debug( 'error', error );
			const message = error && error.toString ? error.toString() : error;
			notices.error( message || translate( 'An error occurred during your purchase.' ) );
		},
		[ translate ]
	);

	const showInfoMessage = useCallback( message => {
		debug( 'info', message );
		notices.info( message );
	}, [] );

	const showSuccessMessage = useCallback( message => {
		debug( 'success', message );
		notices.success( message );
	}, [] );

	const countriesList = useCountryList( overrideCountryList || [] );

	const {
		items,
		tax,
		total,
		credits,
		removeItem,
		addItem,
		changePlanLength,
		errors,
		isLoading,
		allowedPaymentMethods: serverAllowedPaymentMethods,
	} = useShoppingCart( siteSlug, setCart || wpcomSetCart, getCart || wpcomGetCart );

	const { registerStore } = registry;
	useWpcomStore(
		registerStore,
		handleCheckoutEvent,
		validateDomainContactDetails || wpcomValidateDomainContactInformation
	);

	const errorMessages = useMemo( () => errors.map( error => error.message ), [ errors ] );
	useDisplayErrors( errorMessages, showErrorMessage );

	useAddProductToCart( planSlug, isJetpackNotAtomic, addItem );

	const itemsForCheckout = items.length ? [ ...items, tax ] : [];
	debug( 'items for checkout', itemsForCheckout );

	useRedirectIfCartEmpty( items, `/plans/${ siteSlug || '' }` );

	const { storedCards, isLoading: isLoadingStoredCards } = useStoredCards(
		getStoredCards || wpcomGetStoredCards
	);

	const paymentMethods = useMemo(
		() =>
			createPaymentMethods( {
				isLoading: isLoading || isLoadingStoredCards,
				storedCards,
				allowedPaymentMethods: allowedPaymentMethods || serverAllowedPaymentMethods,
				select,
				registerStore,
				wpcom,
				credits,
				total,
				translate,
			} ),
		[
			allowedPaymentMethods,
			serverAllowedPaymentMethods,
			isLoading,
			isLoadingStoredCards,
			storedCards,
			credits,
			registerStore,
			total,
			translate,
		]
	);

	const validateDomainContact =
		validateDomainContactDetails || wpcomValidateDomainContactInformation;

	const renderDomainContactFields = (
		domainNames,
		contactDetails,
		updateContactDetails,
		applyDomainContactValidationResults
	) => {
		return (
			<WPCheckoutErrorBoundary>
				<ContactDetailsFormFields
					countriesList={ countriesList }
					contactDetails={ contactDetails }
					onContactDetailsChange={ updateContactDetails }
					onValidate={ ( values, onComplete ) => {
						// TODO: Should probably handle HTTP errors here
						validateDomainContact( values, domainNames, ( httpErrors, data ) => {
							debug(
								'Domain contact info validation ' + ( data.messages ? 'errors:' : 'successful' ),
								data.messages
							);
							applyDomainContactValidationResults( { ...data.messages } );
							onComplete( httpErrors, data );
						} );
					} }
				/>
			</WPCheckoutErrorBoundary>
		);
	};

	return (
		<React.Fragment>
			<TestingBanner />
			<CheckoutProvider
				locale={ 'en-us' }
				items={ itemsForCheckout }
				total={ total }
				onPaymentComplete={ onPaymentComplete }
				showErrorMessage={ showErrorMessage }
				showInfoMessage={ showInfoMessage }
				showSuccessMessage={ showSuccessMessage }
				onEvent={ handleCheckoutEvent }
				paymentMethods={ paymentMethods }
				registry={ registry }
				isLoading={ isLoading || isLoadingStoredCards }
			>
				<WPCheckout
					removeItem={ removeItem }
					changePlanLength={ changePlanLength }
					siteId={ siteId }
					siteUrl={ siteSlug }
					CountrySelectMenu={ CountrySelectMenu }
					countriesList={ countriesList }
					StateSelect={ StateSelect }
					renderDomainContactFields={ renderDomainContactFields }
				/>
			</CheckoutProvider>
		</React.Fragment>
	);
}

CompositeCheckout.propTypes = {
	siteSlug: PropTypes.string,
	siteId: PropTypes.oneOfType( [ PropTypes.string, PropTypes.number ] ),
	product: PropTypes.string,
	getCart: PropTypes.func,
	setCart: PropTypes.func,
	getStoredCards: PropTypes.func,
	allowedPaymentMethods: PropTypes.array,
};

function useAddProductToCart( planSlug, isJetpackNotAtomic, addItem ) {
	const dispatch = useDispatch();
	const plan = useSelector( state => getPlanBySlug( state, planSlug ) );

	useEffect( () => {
		if ( ! planSlug ) {
			return;
		}
		if ( ! plan ) {
			debug( 'there is a request to add a plan but no plan was found', planSlug );
			dispatch( requestPlans() );
			return;
		}
		debug( 'adding item as requested in url', { planSlug, plan, isJetpackNotAtomic } );
		addItem( createItemToAddToCart( { planSlug, plan, isJetpackNotAtomic } ) );
	}, [ dispatch, planSlug, plan, isJetpackNotAtomic, addItem ] );
}

function useDisplayErrors( errors, displayError ) {
	useEffect( () => {
		errors.map( displayError );
	}, [ errors, displayError ] );
}

function createItemToAddToCart( { planSlug, plan, isJetpackNotAtomic } ) {
	let cartItem, cartMeta;

	if ( planSlug ) {
		cartItem = planItem( planSlug );
		cartItem.product_id = plan.product_id;
	}

	if ( planSlug.startsWith( 'theme' ) ) {
		cartMeta = planSlug.split( ':' )[ 1 ];
		cartItem = themeItem( cartMeta );
	}

	if ( planSlug.startsWith( 'domain-mapping' ) ) {
		cartMeta = planSlug.split( ':' )[ 1 ];
		cartItem = domainMapping( { domain: cartMeta } );
	}

	if ( planSlug.startsWith( 'concierge-session' ) ) {
		// TODO: prevent adding a conciergeSessionItem if one already exists
		cartItem = conciergeSessionItem();
	}

	if ( planSlug.startsWith( 'jetpack_backup' ) && isJetpackNotAtomic ) {
		cartItem = jetpackProductItem( planSlug );
	}

	cartItem.extra = { ...cartItem.extra, context: 'calypstore' };

	return cartItem;
}

function handleCheckoutEvent( action ) {
	debug( 'checkout event', action );
	// TODO: record stats
}

function useRedirectIfCartEmpty( items, redirectUrl ) {
	const [ prevItemsLength, setPrevItemsLength ] = useState( 0 );

	useEffect( () => {
		setPrevItemsLength( items.length );
	}, [ items ] );

	useEffect( () => {
		if ( prevItemsLength > 0 && items.length === 0 ) {
			debug( 'cart has become empty; redirecting...' );
			window.location = redirectUrl;
		}
	}, [ redirectUrl, items, prevItemsLength ] );
}

function useCountryList( overrideCountryList ) {
	// Should we fetch the country list from global state?
	const shouldFetchList = overrideCountryList?.length <= 0;

	const [ countriesList, setCountriesList ] = useState( overrideCountryList );

	const dispatch = useDispatch();
	const globalCountryList = useSelector( state => getCountries( state, 'payments' ) );

	// Has the global list been populated?
	const isListFetched = globalCountryList?.length > 0;

	useEffect( () => {
		if ( shouldFetchList ) {
			if ( isListFetched ) {
				setCountriesList( globalCountryList );
			} else {
				debug( 'countries list is empty; dispatching request for data' );
				dispatch( fetchPaymentCountries() );
			}
		}
	}, [ shouldFetchList, isListFetched, globalCountryList, dispatch ] );

	return countriesList;
}

function CountrySelectMenu( {
	translate,
	onChange,
	isDisabled,
	isError,
	errorMessage,
	currentValue,
	countriesList,
} ) {
	const countrySelectorId = 'country-selector';
	const countrySelectorLabelId = 'country-selector-label';
	const countrySelectorDescriptionId = 'country-selector-description';

	return (
		<FormFieldAnnotation
			labelText={ translate( 'Country' ) }
			isError={ isError }
			isDisabled={ isDisabled }
			formFieldId={ countrySelectorId }
			labelId={ countrySelectorLabelId }
			descriptionId={ countrySelectorDescriptionId }
			errorDescription={ errorMessage }
		>
			<FormCountrySelect
				id={ countrySelectorId }
				countriesList={ [
					{ code: '', name: translate( 'Select Country' ) },
					{ code: null, name: '' },
					...countriesList,
				] }
				translate={ translate }
				onChange={ onChange }
				disabled={ isDisabled }
				value={ currentValue }
				aria-labelledby={ countrySelectorLabelId }
				aria-describedby={ countrySelectorDescriptionId }
			/>
		</FormFieldAnnotation>
	);
}

function TestingBanner() {
	return (
		<Card
			className="composite-checkout__testing-banner"
			highlight="warning"
			href="https://github.com/Automattic/wp-calypso/issues/new?title=New%20checkout&body=%3C!--%20Thanks%20for%20filling%20your%20bug%20report%20for%20our%20New%20checkout!%20Pick%20a%20clear%20title%20(%22New%20checkout%3A%20Continue%20button%20not%20working%22)%20and%20proceed.%20--%3E%0A%0A%23%23%23%23%20Steps%20to%20reproduce%0A1.%20Starting%20at%20URL%3A%0A2.%0A3.%0A4.%0A%0A%23%23%23%23%20What%20I%20expected%0A%0A%0A%23%23%23%23%20What%20happened%20instead%0A%0A%0A%23%23%23%23%20Browser%20%2F%20OS%20version%0A%0A%0A%23%23%23%23%20Screenshot%20%2F%20Video%20(Optional)%0A%0A%40sirbrillig%2C%20%40nbloomf%2C%20%40fditrapani%20%0A"
		>
			Warning! This checkout is a new feature still in testing. If you encounter issues, please
			click here to report them.
		</Card>
	);
}

function getTermText( term, translate ) {
	switch ( term ) {
		case TERM_BIENNIALLY:
			return translate( 'Two years' );

		case TERM_ANNUALLY:
			return translate( 'One year' );

		case TERM_MONTHLY:
			return translate( 'One month' );
	}
}

function getTaxText( translate ) {
	return (
		<sup>
			{ translate( '+tax', {
				comment:
					'This string is displayed immediately next to a localized price with a currency symbol, and is indicating that there may be an additional charge on top of the displayed price.',
			} ) }
		</sup>
	);
}

function useWpcomProductVariants( { siteId, productSlug, credits, couponDiscounts } ) {
	const translate = useTranslate();
	const dispatch = useDispatch();

	const availableVariants = useVariantWpcomPlanProductSlugs( productSlug );

	const productsWithPrices = useSelector( state => {
		return computeProductsWithPrices(
			state,
			siteId,
			availableVariants, // : WPCOMProductSlug[]
			credits || 0, // : number
			couponDiscounts || {} // object of product ID / absolute amount pairs
		);
	} );

	const [ haveFetchedProducts, setHaveFetchedProducts ] = useState( false );
	const shouldFetchProducts = ! productsWithPrices;

	useEffect( () => {
		// Trigger at most one HTTP request
		debug( 'deciding whether to request product variant data' );
		if ( shouldFetchProducts && ! haveFetchedProducts ) {
			debug( 'dispatching request for product variant data' );
			dispatch( requestPlans() );
			dispatch( requestProductsList() );
			setHaveFetchedProducts( true );
		}
	}, [ shouldFetchProducts, haveFetchedProducts ] );

	return anyProductSlug => {
		if ( anyProductSlug !== productSlug ) {
			return [];
		}

		return productsWithPrices.map( variant => {
			const label = getTermText( variant.plan.term, translate );
			const price = (
				<React.Fragment>
					{ variant.product.cost_display }
					{ getTaxText( translate ) }
				</React.Fragment>
			);

			return {
				variantLabel: label,
				variantDetails: price,
				productSlug: variant.planSlug,
				productId: variant.product.product_id,
			};
		} );
	};
}

function useVariantWpcomPlanProductSlugs( productSlug ) {
	const dispatch = useDispatch();

	const chosenPlan = getPlan( productSlug );

	const [ haveFetchedPlans, setHaveFetchedPlans ] = useState( false );
	const shouldFetchPlans = ! chosenPlan;

	useEffect( () => {
		// Trigger at most one HTTP request
		debug( 'deciding whether to request plan variant data for', productSlug );
		if ( shouldFetchPlans && ! haveFetchedPlans ) {
			debug( 'dispatching request for plan variant data' );
			dispatch( requestPlans() );
			dispatch( requestProductsList() );
			setHaveFetchedPlans( true );
		}
	}, [ haveFetchedPlans, shouldFetchPlans ] );

	if ( ! chosenPlan ) {
		return [];
	}

	// Only construct variants for WP.com plans
	if ( chosenPlan.group !== GROUP_WPCOM ) {
		return [];
	}

	// : WPCOMProductSlug[]
	return findPlansKeys( {
		group: chosenPlan.group,
		type: chosenPlan.type,
	} );
}

function getPlanProductSlugs(
	items // : WPCOMCart
) /* : WPCOMCartItem[] */ {
	return items
		.filter( item => {
			return item.type !== 'tax' && getPlan( item.wpcom_meta.product_slug );
		} )
		.map( item => item.wpcom_meta.product_slug );
}
