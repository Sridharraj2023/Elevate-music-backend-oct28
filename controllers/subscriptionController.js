import Stripe from 'stripe';
import User from '../models/userModel.js';

// Debug: Check if STRIPE_SECRET_KEY is loaded
console.log(
  'Subscription Controller - STRIPE_SECRET_KEY:',
  process.env.STRIPE_SECRET_KEY ? 'Found' : 'NOT FOUND',
);

// Initialize Stripe only if secret key is available
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
} else {
  console.warn(
    'Subscription Controller - STRIPE_SECRET_KEY not found - Stripe will not be initialized',
  );
}

export const handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).json({ 
      error: 'Webhook verification failed',
      message: 'Invalid webhook signature'
    });
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object;
      console.log('PaymentIntent was successful!', paymentIntent.id);

      // If this payment intent is for a subscription, update the subscription status
      if (paymentIntent.metadata?.subscription_id) {
        const subscriptionId = paymentIntent.metadata.subscription_id;
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);

        if (subscription.status === 'active' || subscription.status === 'trialing') {
          // Safely set currentPeriodEnd with validation
          let currentPeriodEnd;
          if (subscription.current_period_end) {
            currentPeriodEnd = new Date(subscription.current_period_end * 1000);
          } else {
            // Fallback: set based on interval
            const interval = subscription.items.data[0]?.plan?.interval || 'month';
            const validityDays = interval === 'year' ? 365 : 30;
            currentPeriodEnd = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);
          }

          await User.findOneAndUpdate(
            { 'subscription.id': subscriptionId },
            {
              'subscription.status': subscription.status,
              'subscription.currentPeriodEnd': currentPeriodEnd,
              'subscription.paymentDate': new Date(),
              'subscription.interval': subscription.items.data[0]?.plan?.interval || 'month',
            },
          );
          console.log('Updated subscription status to active for subscription:', subscriptionId);
        }
      }
      break;
    }

    case 'charge.succeeded':
      const charge = event.data.object;
      console.log('Charge was successful!', charge.id);

      // If this charge is for a subscription, update the subscription status
      if (charge.metadata?.subscription_id) {
        const subscriptionId = charge.metadata.subscription_id;
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);

        console.log('Charge succeeded for subscription:', {
          subscriptionId: subscription.id,
          status: subscription.status,
          chargeId: charge.id,
          paymentMethod: charge.payment_method,
          paymentIntent: charge.payment_intent,
        });

        if (subscription.status === 'active' || subscription.status === 'trialing') {
          // Safely set currentPeriodEnd with validation
          let currentPeriodEnd;
          if (subscription.current_period_end) {
            currentPeriodEnd = new Date(subscription.current_period_end * 1000);
          } else {
            // Fallback: set based on interval
            const interval = subscription.items.data[0]?.plan?.interval || 'month';
            const validityDays = interval === 'year' ? 365 : 30;
            currentPeriodEnd = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);
          }

          await User.findOneAndUpdate(
            { 'subscription.id': subscriptionId },
            {
              'subscription.status': subscription.status,
              'subscription.currentPeriodEnd': currentPeriodEnd,
              'subscription.paymentDate': new Date(),
              'subscription.interval': subscription.items.data[0]?.plan?.interval || 'month',
            },
          );
          console.log('Updated subscription status to active for subscription:', subscriptionId);
        } else if (subscription.status === 'incomplete') {
          // Since payment succeeded, mark subscription as active in our database
          // This is a workaround for Stripe's payment method reuse limitation
          try {
            console.log(
              'Payment succeeded via webhook, marking subscription as active in database...',
            );

            // Safely set currentPeriodEnd with validation
            let currentPeriodEnd;
            if (subscription.current_period_end) {
              currentPeriodEnd = new Date(subscription.current_period_end * 1000);
            } else {
              // Fallback: set based on interval
              const interval = subscription.items.data[0]?.plan?.interval || 'month';
              const validityDays = interval === 'year' ? 365 : 30;
              currentPeriodEnd = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);
            }

            await User.findOneAndUpdate(
              { 'subscription.id': subscriptionId },
              {
                'subscription.status': 'active',
                'subscription.currentPeriodEnd': currentPeriodEnd,
                'subscription.paymentDate': new Date(),
                'subscription.interval': subscription.items.data[0]?.plan?.interval || 'month',
              },
            );
            console.log('Updated subscription to active via webhook:', subscriptionId);
          } catch (updateError) {
            console.error('Error updating subscription via webhook:', updateError);
          }
        }
      }
      break;

    case 'payment_intent.payment_failed':
      const paymentFailed = event.data.object;
      console.log('Payment failed:', paymentFailed.id);
      // Handle failed payment
      break;

    case 'customer.subscription.created':
      const subscriptionCreated = event.data.object;
      console.log('Subscription created:', subscriptionCreated.id);

      // Safely set currentPeriodEnd with validation
      let currentPeriodEnd;
      if (subscriptionCreated.current_period_end) {
        currentPeriodEnd = new Date(subscriptionCreated.current_period_end * 1000);
      } else {
        // Fallback: set based on interval
        const interval = subscriptionCreated.items.data[0]?.plan?.interval || 'month';
        const validityDays = interval === 'year' ? 365 : 30;
        currentPeriodEnd = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);
      }

      await User.findOneAndUpdate(
        { stripeCustomerId: subscriptionCreated.customer },
        {
          'subscription.status': subscriptionCreated.status,
          'subscription.currentPeriodEnd': currentPeriodEnd,
          'subscription.paymentDate': new Date(),
          'subscription.interval': subscriptionCreated.items.data[0]?.plan?.interval || 'month',
        },
      );
      break;

    case 'customer.subscription.updated':
      const subscriptionUpdated = event.data.object;
      console.log('Subscription updated:', subscriptionUpdated.id);

      // Safely set currentPeriodEnd with validation
      let currentPeriodEndUpdated;
      if (subscriptionUpdated.current_period_end) {
        currentPeriodEndUpdated = new Date(subscriptionUpdated.current_period_end * 1000);
      } else {
        // Fallback: set based on interval
        const interval = subscriptionUpdated.items.data[0]?.plan?.interval || 'month';
        const validityDays = interval === 'year' ? 365 : 30;
        currentPeriodEndUpdated = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);
      }

      await User.findOneAndUpdate(
        { stripeCustomerId: subscriptionUpdated.customer },
        {
          'subscription.status': subscriptionUpdated.status,
          'subscription.currentPeriodEnd': currentPeriodEndUpdated,
          'subscription.paymentDate': new Date(),
          'subscription.interval': subscriptionUpdated.items.data[0]?.plan?.interval || 'month',
        },
      );
      break;

    case 'customer.subscription.deleted':
      const subscriptionDeleted = event.data.object;
      console.log('Subscription deleted:', subscriptionDeleted.id);
      await User.findOneAndUpdate(
        { stripeCustomerId: subscriptionDeleted.customer },
        {
          'subscription.status': 'canceled',
          'subscription.currentPeriodEnd': null,
        },
      );
      break;

    case 'invoice.payment_succeeded':
      const invoicePaid = event.data.object;
      console.log('Invoice paid:', invoicePaid.id);
      // Update user subscription status to active
      await User.findOneAndUpdate(
        { stripeCustomerId: invoicePaid.customer },
        {
          'subscription.status': 'active',
          'subscription.currentPeriodEnd': new Date(invoicePaid.period_end * 1000),
          'subscription.paymentDate': new Date(),
        },
      );
      break;

    case 'invoice.payment_failed':
      const invoiceFailed = event.data.object;
      console.log('Invoice payment failed:', invoiceFailed.id);
      // Update user subscription status to past_due
      await User.findOneAndUpdate(
        { stripeCustomerId: invoiceFailed.customer },
        {
          'subscription.status': 'past_due',
        },
      );
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  // Return a 200 response to acknowledge receipt of the event
  res.json({ received: true });
};

// GET /subscriptions/status - Get current subscription status
export const getSubscriptionStatus = async (req, res) => {
  try {
    const userId = req.user && req.user._id;
    if (!userId) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const user = await User.findById(userId);
    if (!user || !user.subscription || !user.subscription.id) {
      return res.json({
        subscription: null,
      });
    }

    // Get latest subscription data from Stripe
    const subscription = await stripe.subscriptions.retrieve(user.subscription.id);

    // Get interval from user's database record (more reliable than Stripe)
    const interval =
      user.subscription.interval || subscription.items.data[0]?.plan?.interval || 'month';

    // Use currentPeriodEnd from user's database record (more reliable than Stripe)
    const currentPeriodEnd = user.subscription.currentPeriodEnd
      ? Math.floor(new Date(user.subscription.currentPeriodEnd).getTime() / 1000)
      : subscription.current_period_end;

    const response = {
      subscription: {
        id: subscription.id,
        status: subscription.status,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: currentPeriodEnd, // Use currentPeriodEnd from user's database record
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        plan: subscription.items.data[0]?.price?.id,
        interval: interval, // Use interval from user's database record
        isActive: subscription.status === 'active' || subscription.status === 'trialing',
      },
    };

    return res.json(response);
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    return res.status(500).json({
      message: 'Failed to fetch subscription status',
      error: error.message,
    });
  }
};

// POST /subscriptions/update-payment-method - Update subscription with payment method from payment intent
export const updateSubscriptionPaymentMethod = async (req, res) => {
  try {
    const userId = req.user && req.user._id;
    if (!userId) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const { paymentIntentId } = req.body;
    if (!paymentIntentId) {
      return res.status(400).json({ message: 'Payment intent ID is required' });
    }

    const user = await User.findById(userId);
    if (!user || !user.subscription || !user.subscription.id) {
      return res.status(404).json({
        message: 'No subscription found',
      });
    }

    // Retrieve the payment intent to get the payment method
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    console.log('Retrieved payment intent:', {
      id: paymentIntent.id,
      status: paymentIntent.status,
      payment_method: paymentIntent.payment_method,
      customer: paymentIntent.customer,
    });

    // Check payment intent status - it might be 'requires_confirmation' or 'processing'
    if (paymentIntent.status === 'requires_payment_method') {
      return res.status(400).json({
        message: 'Payment intent requires payment method',
        status: paymentIntent.status,
      });
    }

    if (paymentIntent.status === 'canceled') {
      return res.status(400).json({
        message: 'Payment intent was canceled',
        status: paymentIntent.status,
      });
    }

    // For 'processing' or 'requires_confirmation', we can still try to proceed
    if (
      paymentIntent.status !== 'succeeded' &&
      paymentIntent.status !== 'processing' &&
      paymentIntent.status !== 'requires_confirmation'
    ) {
      return res.status(400).json({
        message: 'Payment intent is not ready yet',
        status: paymentIntent.status,
      });
    }

    // If payment intent is not succeeded yet, try to confirm it
    if (paymentIntent.status === 'requires_confirmation') {
      try {
        console.log('Confirming payment intent...');
        const confirmedPaymentIntent = await stripe.paymentIntents.confirm(paymentIntent.id);
        console.log('Payment intent confirmed:', confirmedPaymentIntent.status);

        if (confirmedPaymentIntent.status === 'succeeded') {
          // Update the payment intent reference
          paymentIntent.status = confirmedPaymentIntent.status;
          paymentIntent.payment_method = confirmedPaymentIntent.payment_method;
        }
      } catch (confirmError) {
        console.error('Error confirming payment intent:', confirmError);
        // Continue with original payment intent
      }
    }

    // First, attach the payment method to the customer if it's not already attached
    if (paymentIntent.payment_method) {
      try {
        await stripe.paymentMethods.attach(paymentIntent.payment_method, {
          customer: user.stripeCustomerId,
        });
        console.log('Payment method attached to customer:', paymentIntent.payment_method);
      } catch (attachError) {
        // If already attached, that's fine
        if (attachError.code !== 'resource_already_exists') {
          console.error('Error attaching payment method:', attachError);
          // Try alternative approach - update customer's default payment method
          try {
            await stripe.customers.update(user.stripeCustomerId, {
              invoice_settings: {
                default_payment_method: paymentIntent.payment_method,
              },
            });
            console.log('Set customer default payment method:', paymentIntent.payment_method);
          } catch (updateError) {
            console.error('Error setting customer default payment method:', updateError);
            throw attachError; // Throw original error
          }
        } else {
          console.log('Payment method already attached to customer');
        }
      }
    }

    // Try to update the subscription with the payment method
    let subscription;
    try {
      subscription = await stripe.subscriptions.update(user.subscription.id, {
        default_payment_method: paymentIntent.payment_method,
        collection_method: 'charge_automatically',
      });
    } catch (updateError) {
      console.error('Error updating subscription with payment method:', updateError);

      // Alternative approach: try to finalize and pay the invoice
      try {
        console.log('Trying alternative approach - finalizing invoice...');
        const subscriptionData = await stripe.subscriptions.retrieve(user.subscription.id, {
          expand: ['latest_invoice'],
        });

        if (subscriptionData.latest_invoice) {
          const invoice = await stripe.invoices.finalizeInvoice(subscriptionData.latest_invoice.id);
          await stripe.invoices.pay(invoice.id, {
            payment_intent: paymentIntent.id,
          });

          // Re-fetch the subscription to get updated status
          subscription = await stripe.subscriptions.retrieve(user.subscription.id);
          console.log('Invoice paid successfully, subscription status:', subscription.status);
        } else {
          throw updateError; // Re-throw original error if no invoice
        }
      } catch (invoiceError) {
        console.error('Error with invoice approach:', invoiceError);
        throw updateError; // Re-throw original error
      }
    }

    console.log('Subscription updated with payment method:', {
      subscriptionId: subscription.id,
      status: subscription.status,
      paymentMethod: paymentIntent.payment_method,
    });

    // Update user subscription status
    user.subscription.status = subscription.status;
    user.subscription.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
    user.subscription.paymentDate = new Date();
    await user.save();

    // If subscription is still incomplete, wait a moment and check again
    if (subscription.status === 'incomplete') {
      console.log('Subscription still incomplete, waiting and checking again...');
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const updatedSubscription = await stripe.subscriptions.retrieve(user.subscription.id);
      console.log('Updated subscription status after wait:', updatedSubscription.status);

      if (updatedSubscription.status === 'active' || updatedSubscription.status === 'trialing') {
        user.subscription.status = updatedSubscription.status;
        user.subscription.currentPeriodEnd = new Date(
          updatedSubscription.current_period_end * 1000,
        );
        user.subscription.paymentDate = new Date();
        await user.save();
        subscription = updatedSubscription;
      }
    }

    return res.json({
      message: 'Subscription updated with payment method',
      subscription: {
        id: subscription.id,
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end,
        isActive: subscription.status === 'active' || subscription.status === 'trialing',
      },
    });
  } catch (error) {
    console.error('Error updating subscription payment method:', error);

    // Handle specific Stripe errors
    let errorMessage = 'Failed to update subscription payment method';
    if (
      error.message.includes('payment method with the ID') &&
      error.message.includes('must be attached')
    ) {
      errorMessage = 'Payment method attachment error. Please try again.';
    } else if (error.message.includes('payment_intent')) {
      errorMessage = 'Payment intent error. Please try again.';
    } else if (error.message.includes('subscription')) {
      errorMessage = 'Subscription update error. Please try again.';
    }

    return res.status(500).json({
      message: errorMessage,
      error: error.message,
    });
  }
};

// POST /subscriptions/fix-status - Manually fix subscription status based on successful charge
export const fixSubscriptionStatus = async (req, res) => {
  try {
    const userId = req.user && req.user._id;
    if (!userId) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const user = await User.findById(userId);
    if (!user || !user.subscription || !user.subscription.id) {
      return res.status(404).json({
        message: 'No subscription found',
      });
    }

    // Get the subscription from Stripe
    const subscription = await stripe.subscriptions.retrieve(user.subscription.id, {
      expand: ['latest_invoice', 'latest_invoice.payment_intent'],
    });

    console.log('Current subscription status:', {
      id: subscription.id,
      status: subscription.status,
      latest_invoice: subscription.latest_invoice?.id,
      payment_intent: subscription.latest_invoice?.payment_intent?.id,
    });

    // Check for successful charges for this subscription
    const charges = await stripe.charges.list({
      customer: user.stripeCustomerId,
      limit: 10,
    });

    console.log(
      'Recent charges for customer:',
      charges.data.map((charge) => ({
        id: charge.id,
        status: charge.status,
        payment_intent: charge.payment_intent,
        subscription_id: charge.metadata?.subscription_id,
      })),
    );

    // Find successful charge for this subscription
    // Try multiple ways to match the charge to the subscription
    const successfulCharge = charges.data.find(
      (charge) =>
        charge.status === 'succeeded' &&
        (charge.metadata?.subscription_id === subscription.id ||
          charge.subscription === subscription.id ||
          charge.description?.includes(subscription.id)),
    );

    if (successfulCharge) {
      console.log('Found successful charge for subscription:', {
        chargeId: successfulCharge.id,
        paymentIntent: successfulCharge.payment_intent,
        paymentMethod: successfulCharge.payment_method,
      });

      // Since the payment method can't be reused, let's try a different approach
      // First, check if the subscription is already active due to the successful payment
      const currentSubscription = await stripe.subscriptions.retrieve(subscription.id);

      if (currentSubscription.status === 'active' || currentSubscription.status === 'trialing') {
        console.log('Subscription is already active after successful charge');

        // Update user subscription status
        user.subscription.status = currentSubscription.status;

        // Safely set currentPeriodEnd with validation
        if (currentSubscription.current_period_end) {
          user.subscription.currentPeriodEnd = new Date(
            currentSubscription.current_period_end * 1000,
          );
        } else {
          // Fallback: set based on interval
          const interval = currentSubscription.items.data[0]?.plan?.interval || 'month';
          const validityDays = interval === 'year' ? 365 : 30;
          user.subscription.currentPeriodEnd = new Date(
            Date.now() + validityDays * 24 * 60 * 60 * 1000,
          );
        }

        user.subscription.paymentDate = new Date();
        user.subscription.interval = currentSubscription.items.data[0]?.plan?.interval || 'month';
        await user.save();

        return res.json({
          message: 'Subscription is already active after successful charge',
          subscription: {
            id: currentSubscription.id,
            status: currentSubscription.status,
            currentPeriodEnd: currentSubscription.current_period_end,
            isActive: true,
          },
        });
      }

      // Since payment succeeded, mark subscription as active in our database
      // This is a workaround for Stripe's payment method reuse limitation
      console.log('Payment succeeded, marking subscription as active in database');

      // Use Stripe's actual currentPeriodEnd from the retrieved subscription
      user.subscription.status = 'active';

      // Safely set currentPeriodEnd with validation
      if (currentSubscription.current_period_end) {
        user.subscription.currentPeriodEnd = new Date(
          currentSubscription.current_period_end * 1000,
        );
        console.log('Set currentPeriodEnd from Stripe:', user.subscription.currentPeriodEnd);
      } else {
        // Fallback: set based on interval
        const interval = currentSubscription.items.data[0]?.plan?.interval || 'month';
        const validityDays = interval === 'year' ? 365 : 30;
        user.subscription.currentPeriodEnd = new Date(
          Date.now() + validityDays * 24 * 60 * 60 * 1000,
        );
        console.log(
          `Set currentPeriodEnd fallback: ${validityDays} days from now (${interval} interval):`,
          user.subscription.currentPeriodEnd,
        );
      }

      user.subscription.paymentDate = new Date();
      user.subscription.interval = currentSubscription.items.data[0]?.plan?.interval || 'month';

      console.log('Saving user subscription with:', {
        status: user.subscription.status,
        interval: user.subscription.interval,
        currentPeriodEnd: user.subscription.currentPeriodEnd,
      });

      await user.save();

      return res.json({
        message: 'Subscription activated - payment was successful',
        subscription: {
          id: subscription.id,
          status: 'active',
          currentPeriodEnd: user.subscription.currentPeriodEnd.getTime() / 1000,
          isActive: true,
        },
      });
    }

    // If subscription is incomplete but has a successful payment intent, try to activate it
    if (subscription.status === 'incomplete' && subscription.latest_invoice?.payment_intent) {
      const paymentIntent = subscription.latest_invoice.payment_intent;

      if (paymentIntent.status === 'succeeded' && paymentIntent.payment_method) {
        console.log('Payment intent succeeded, updating subscription...');

        // Update subscription with payment method
        const updatedSubscription = await stripe.subscriptions.update(subscription.id, {
          default_payment_method: paymentIntent.payment_method,
          collection_method: 'charge_automatically',
        });

        console.log('Subscription updated:', {
          id: updatedSubscription.id,
          status: updatedSubscription.status,
        });

        // Update user subscription status
        user.subscription.status = updatedSubscription.status;
        user.subscription.currentPeriodEnd = new Date(
          updatedSubscription.current_period_end * 1000,
        );
        user.subscription.paymentDate = new Date();
        await user.save();

        return res.json({
          message: 'Subscription status fixed and activated',
          subscription: {
            id: updatedSubscription.id,
            status: updatedSubscription.status,
            currentPeriodEnd: updatedSubscription.current_period_end,
            isActive:
              updatedSubscription.status === 'active' || updatedSubscription.status === 'trialing',
          },
        });
      }
    }

    // If already active, just return current status
    if (subscription.status === 'active' || subscription.status === 'trialing') {
      user.subscription.status = subscription.status;
      user.subscription.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
      user.subscription.paymentDate = new Date();
      await user.save();

      return res.json({
        message: 'Subscription is already active',
        subscription: {
          id: subscription.id,
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end,
          isActive: true,
        },
      });
    }

    // If no successful charge found, try to find recent payment intent
    console.log('No successful charge found, checking recent payment intents...');

    const paymentIntents = await stripe.paymentIntents.list({
      customer: user.stripeCustomerId,
      limit: 5,
    });

    const recentSuccessfulPayment = paymentIntents.data.find(
      (pi) =>
        pi.status === 'succeeded' &&
        (pi.metadata?.subscription_id === subscription.id ||
          pi.description?.includes(subscription.id)),
    );

    if (recentSuccessfulPayment) {
      console.log('Found recent successful payment intent, fixing subscription...');

      // Force mark subscription as active with proper interval
      user.subscription.status = 'active';

      // Get the subscription details to determine interval
      const subscriptionDetails = await stripe.subscriptions.retrieve(subscription.id);
      const interval = subscriptionDetails.items.data[0]?.plan?.interval || 'month';
      const validityDays = interval === 'year' ? 365 : 30;

      user.subscription.currentPeriodEnd = new Date(
        Date.now() + validityDays * 24 * 60 * 60 * 1000,
      );
      user.subscription.paymentDate = new Date();
      user.subscription.interval = interval;

      console.log(`Fixed subscription with ${interval} interval, ${validityDays} days validity`);

      await user.save();

      return res.json({
        message: 'Subscription fixed - payment was successful',
        subscription: {
          id: subscription.id,
          status: 'active',
          interval: interval,
          validityDays: validityDays,
          isActive: true,
        },
      });
    }

    return res.status(400).json({
      message: 'Subscription cannot be activated - no successful payment found',
      status: subscription.status,
      isActive: false,
    });
  } catch (error) {
    console.error('Error fixing subscription status:', error);
    return res.status(500).json({
      message: 'Failed to fix subscription status',
      error: error.message,
    });
  }
};

// POST /subscriptions/confirm - Manually confirm payment and activate subscription
export const confirmPayment = async (req, res) => {
  try {
    const userId = req.user && req.user._id;
    if (!userId) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const user = await User.findById(userId);
    if (!user || !user.subscription || !user.subscription.id) {
      return res.status(404).json({
        message: 'No subscription found',
      });
    }

    // Get subscription from Stripe with expanded invoice and payment intent
    const subscription = await stripe.subscriptions.retrieve(user.subscription.id, {
      expand: ['latest_invoice', 'latest_invoice.payment_intent'],
    });

    console.log('Confirming payment for subscription:', {
      id: subscription.id,
      status: subscription.status,
      latest_invoice: subscription.latest_invoice?.id,
      payment_intent_status: subscription.latest_invoice?.payment_intent?.status,
    });

    // Check if payment was successful
    if (subscription.status === 'active' || subscription.status === 'trialing') {
      // Update user subscription status
      user.subscription.status = subscription.status;
      user.subscription.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
      user.subscription.paymentDate = new Date();
      await user.save();

      return res.json({
        message: 'Subscription confirmed and activated',
        subscription: {
          id: subscription.id,
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end,
          isActive: true,
        },
      });
    } else if (subscription.status === 'incomplete') {
      // Check if the payment intent was successful
      const paymentIntent = subscription.latest_invoice?.payment_intent;
      if (paymentIntent && paymentIntent.status === 'succeeded') {
        // Payment succeeded but subscription is still incomplete
        // This can happen due to timing - wait a moment and retry
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Re-fetch the subscription to check if it's now active
        const updatedSubscription = await stripe.subscriptions.retrieve(subscription.id);

        if (updatedSubscription.status === 'active' || updatedSubscription.status === 'trialing') {
          user.subscription.status = updatedSubscription.status;
          user.subscription.currentPeriodEnd = new Date(
            updatedSubscription.current_period_end * 1000,
          );
          user.subscription.paymentDate = new Date();
          await user.save();

          return res.json({
            message: 'Subscription confirmed and activated',
            subscription: {
              id: updatedSubscription.id,
              status: updatedSubscription.status,
              currentPeriodEnd: updatedSubscription.current_period_end,
              isActive: true,
            },
          });
        }
      }

      return res.status(400).json({
        message: 'Subscription is not active yet',
        status: subscription.status,
        payment_intent_status: paymentIntent?.status,
        isActive: false,
      });
    } else {
      return res.status(400).json({
        message: 'Subscription is not active yet',
        status: subscription.status,
        isActive: false,
      });
    }
  } catch (error) {
    console.error('Error confirming payment:', error);
    return res.status(500).json({
      message: 'Failed to confirm payment',
      error: error.message,
    });
  }
};

// GET /subscriptions/details - Get detailed subscription information including countdown
export const getSubscriptionDetails = async (req, res) => {
  try {
    const userId = req.user && req.user._id;
    if (!userId) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const user = await User.findById(userId);
    if (!user || !user.subscription || !user.subscription.id) {
      return res.status(404).json({
        message: 'No subscription found',
      });
    }

    // Get latest subscription data from Stripe
    const subscription = await stripe.subscriptions.retrieve(user.subscription.id);

    // Get interval from subscription
    const interval =
      subscription.items.data[0]?.plan?.interval || user.subscription.interval || 'month';

    // Calculate countdown information using Stripe's actual currentPeriodEnd
    const now = new Date();
    const expiryDate = new Date(subscription.current_period_end * 1000);
    const timeDiff = expiryDate.getTime() - now.getTime();
    const remainingDays = Math.max(0, Math.ceil(timeDiff / (1000 * 60 * 60 * 24)));

    // Determine validity status based on remaining days
    let validityStatus = 'unknown';
    if (remainingDays > 7) {
      validityStatus = 'good';
    } else if (remainingDays > 3) {
      validityStatus = 'warning';
    } else if (remainingDays > 0) {
      validityStatus = 'critical';
    } else {
      validityStatus = 'expired';
    }

    const response = {
      subscription: {
        id: subscription.id,
        status: subscription.status,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        plan: subscription.items.data[0]?.price?.id,
        interval: interval, // Add interval info
        isActive: subscription.status === 'active' || subscription.status === 'trialing',
      },
      paymentInfo: {
        paymentDate: user.subscription.paymentDate,
        expiryDate: expiryDate,
        remainingDays: remainingDays,
        validityDays: interval === 'year' ? 365 : 30, // Dynamic validity based on interval
        validityStatus: validityStatus,
        interval: interval, // Add interval to payment info
      },
    };

    return res.json(response);
  } catch (error) {
    console.error('Error fetching subscription details:', error);
    return res.status(500).json({
      message: 'Failed to fetch subscription details',
      error: error.message,
    });
  }
};

// POST /subscriptions/cancel - Cancel subscription at period end
export const cancelSubscription = async (req, res) => {
  try {
    const userId = req.user && req.user._id;
    if (!userId) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const user = await User.findById(userId);
    if (!user || !user.subscription || !user.subscription.id) {
      return res.status(404).json({
        message: 'No active subscription found',
      });
    }

    // Cancel subscription at period end
    const subscription = await stripe.subscriptions.update(user.subscription.id, {
      cancel_at_period_end: true,
    });

    // Update user subscription status
    user.subscription.status = subscription.status;
    user.subscription.cancelAtPeriodEnd = subscription.cancel_at_period_end;
    await user.save();

    return res.json({
      message: 'Subscription will be canceled at the end of the current period',
      subscription: {
        id: subscription.id,
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    return res.status(500).json({
      message: 'Failed to cancel subscription',
      error: error.message,
    });
  }
};

// POST /payments/setup-intent - Create SetupIntent for payment method collection
export const createSetupIntent = async (req, res) => {
  try {
    const userId = req.user && req.user._id;
    if (!userId) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Create Stripe customer if not exists
    let stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
      });
      stripeCustomerId = customer.id;
      user.stripeCustomerId = stripeCustomerId;
      await user.save();
    }

    // Create SetupIntent for collecting payment method
    const setupIntent = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      usage: 'off_session', // For future payments
      metadata: {
        user_id: userId.toString(),
      },
    });

    console.log('SetupIntent created:', {
      id: setupIntent.id,
      customer: setupIntent.customer,
      status: setupIntent.status,
    });

    return res.json({
      clientSecret: setupIntent.client_secret,
    });
  } catch (error) {
    console.error('Error creating SetupIntent:', error);
    return res.status(500).json({
      message: 'Failed to create setup intent',
      error: error.message,
    });
  }
};

// PUT /subscriptions/auto-debit - Toggle auto-debit preference
export const setAutoDebit = async (req, res) => {
  try {
    const userId = req.user && req.user._id;
    if (!userId) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const { autoDebit } = req.body;
    if (typeof autoDebit !== 'boolean') {
      return res.status(400).json({ message: 'autoDebit must be a boolean value' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update user's auto-debit preference
    user.autoDebit = autoDebit;
    await user.save();

    return res.json({
      message: 'Auto-debit preference updated',
      autoDebit: user.autoDebit,
    });
  } catch (error) {
    console.error('Error updating auto-debit preference:', error);
    return res.status(500).json({
      message: 'Failed to update auto-debit preference',
      error: error.message,
    });
  }
};

// POST /subscriptions/create
export const createSubscription = async (req, res) => {
  try {
    const userId = req.user && req.user._id;
    if (!userId) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Use dynamic priceId from client/admin-config; fallback to env
    const clientPriceId = req.body?.priceId;
    const priceId = clientPriceId || process.env.STRIPE_PRICE_ID;
    if (!priceId) {
      return res.status(400).json({ message: 'Stripe price ID missing' });
    }
    if (clientPriceId && typeof clientPriceId !== 'string') {
      return res.status(400).json({ message: 'Invalid priceId' });
    }

    // Create Stripe customer if not exists
    let stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
      });
      stripeCustomerId = customer.id;
      user.stripeCustomerId = stripeCustomerId;
      await user.save();
    }

    try {
      console.log('Creating subscription with price ID:', priceId);

      // Create subscription with payment settings
      const subscription = await stripe.subscriptions.create({
        customer: stripeCustomerId,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: {
          payment_method_types: ['card'],
          save_default_payment_method: 'on_subscription',
        },
        expand: ['latest_invoice.payment_intent'],
        collection_method: 'charge_automatically',
        metadata: {
          user_id: userId.toString(),
        },
      });

      console.log('Subscription created:', {
        id: subscription.id,
        status: subscription.status,
        latest_invoice: subscription.latest_invoice?.id,
        payment_intent: subscription.latest_invoice?.payment_intent?.id,
        payment_intent_status: subscription.latest_invoice?.payment_intent?.status,
      });

      // Debug: Check if payment intent exists
      if (subscription.latest_invoice?.payment_intent) {
        console.log('Payment intent found:', subscription.latest_invoice.payment_intent);
      } else {
        console.log('No payment intent in subscription.latest_invoice');
      }

      // Get the client secret from the subscription's payment intent
      let clientSecret = subscription.latest_invoice?.payment_intent?.client_secret;

      // Fallback: If no payment intent is attached, try to retrieve it from the invoice
      if (!clientSecret && subscription.latest_invoice) {
        console.log('No payment intent in subscription, retrieving from invoice...');
        const invoice = await stripe.invoices.retrieve(subscription.latest_invoice.id, {
          expand: ['payment_intent'],
        });

        if (invoice.payment_intent) {
          console.log('Found payment intent in invoice');
          clientSecret = invoice.payment_intent.client_secret;
        } else {
          // Last resort: create a standalone payment intent for the subscription
          // This payment intent will be used by the client to collect payment method
          // and then the subscription will be updated with the payment method
          console.log('Creating new payment intent for subscription:', subscription.id);
          console.log('Invoice amount due:', invoice.amount_due, invoice.currency);

          // First, try to finalize the invoice to see if it creates a payment intent
          try {
            const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
            console.log('Invoice finalized:', finalizedInvoice.id);

            if (finalizedInvoice.payment_intent) {
              console.log(
                'Payment intent found after finalizing invoice:',
                finalizedInvoice.payment_intent,
              );
              clientSecret = finalizedInvoice.payment_intent.client_secret;
            } else {
              // Create a standalone payment intent
              const paymentIntent = await stripe.paymentIntents.create({
                customer: stripeCustomerId,
                amount: invoice.amount_due,
                currency: invoice.currency,
                payment_method_types: ['card'],
                description: `Subscription creation for ${subscription.id}`,
                metadata: {
                  subscription_id: subscription.id,
                  invoice_id: invoice.id,
                  user_id: userId.toString(),
                },
              });

              console.log('Payment intent created for subscription:', paymentIntent);
              clientSecret = paymentIntent.client_secret;
            }
          } catch (finalizeError) {
            console.error('Error finalizing invoice:', finalizeError);

            // Create a standalone payment intent as fallback
            const paymentIntent = await stripe.paymentIntents.create({
              customer: stripeCustomerId,
              amount: invoice.amount_due,
              currency: invoice.currency,
              payment_method_types: ['card'],
              description: `Subscription creation for ${subscription.id}`,
              metadata: {
                subscription_id: subscription.id,
                invoice_id: invoice.id,
                user_id: userId.toString(),
              },
            });

            console.log('Payment intent created for subscription (fallback):', paymentIntent);
            clientSecret = paymentIntent.client_secret;
          }
        }
      }

      if (!clientSecret) {
        console.error('No client secret available after fallback attempts:', {
          subscriptionId: subscription.id,
          invoiceId: subscription.latest_invoice?.id,
          paymentIntent: subscription.latest_invoice?.payment_intent,
        });
        throw new Error('Failed to retrieve or create payment intent');
      }

      // Get interval from subscription (monthly or yearly)
      const interval = subscription.items.data[0]?.plan?.interval || 'month';
      const validityDays = interval === 'year' ? 365 : 30;

      // Save subscription details to user
      user.subscription = {
        id: subscription.id,
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end,
        paymentDate: new Date(), // Save payment date even for incomplete subscriptions
        validityDays: validityDays,
        interval: interval,
      };
      await user.save();

      // Return the client secret for the client to complete the payment
      const responseData = {
        subscription: {
          clientSecret: clientSecret,
        },
      };

      console.log('Returning to client:', responseData);

      return res.json(responseData);
    } catch (error) {
      console.error('Stripe subscription error:', {
        message: error.message,
        stack: error.stack,
        response: error.response?.data,
      });

      // Handle specific Stripe errors
      let errorMessage = 'Failed to create subscription';
      if (
        error.message.includes('automatic_payment_methods') &&
        error.message.includes('payment_method_types')
      ) {
        errorMessage = 'Payment method configuration error. Please try again.';
      } else if (
        error.message.includes('payment_intent') &&
        error.message.includes('payment_settings')
      ) {
        errorMessage = 'Payment setup error. Please try again.';
      } else if (error.message.includes('price')) {
        errorMessage = 'Invalid subscription plan. Please contact support.';
      } else if (error.message.includes('customer')) {
        errorMessage = 'Customer account error. Please try again.';
      } else if (error.message.includes('invoice')) {
        errorMessage = 'Invoice processing error. Please try again.';
      }

      return res.status(500).json({
        message: errorMessage,
        error: error.message,
        details: error.type || 'Unknown error',
      });
    }
  } catch (error) {
    console.error('Stripe subscription error:', error);
    return res.status(500).json({ message: 'Subscription creation failed', error: error.message });
  }
};
