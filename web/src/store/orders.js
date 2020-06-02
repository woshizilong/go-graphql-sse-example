import Vue from 'vue'
import {Order} from '../model/order'

let activeEventSources = []

const orderSelection = `
  id
  queueId
  createdAt
  updatedAt
  status
  eta
  totalSum
`

const orderSelectionFull = `
  ${orderSelection}
  items
  products {
    id
    name
  }
`

const state = () => ({
    orders: [],
    myOrder: null
})

const getters = {
    orderRefs: (state) => (id) => {
        return state.orders.filter(o => o.id === id)
            .concat(state.myOrder.id === id ? [state.myOrder] : [])
    },
    pendingOrders: (state) => {
        return state.orders.filter(o => o.isPending)
    },
    deliveringOrders: (state) => {
        return state.orders.filter(o => o.isDelivering)
    },
    fulfilledOrders: (state) => {
        return state.orders.filter(o => o.isFulfilled)
    }
}

const mutations = {
    setMyOrder(state, order) {
        Vue.set(state, 'myOrder', order)
    },
    clearMyOrder(state) {
        Vue.set(state, 'myOrder', null)
    },
    addOrder(state, order) {
        state.orders.push(order)
    },
    setOrders(state, orders) {
        Vue.set(state, 'orders', orders)
    },
    updateOrder(state, update) {
        const orderRefs = state.orders.filter(o => o.id === update.id)
            .concat(state.myOrder && state.myOrder.id === update.id ? [state.myOrder] : [])

        orderRefs.forEach(ref => {
            Object.entries(update).forEach(e => {
                Vue.set(ref, e[0], e[1])
            })
        })
    },
    clearSubscriptions() {
        activeEventSources.forEach(s => s.disconnect())
        activeEventSources = []
    }
}

const actions = {
    async fetchOrder({commit, state}, {id, full, target}) {
        const q = `query {
          order(id: "${id}") {
            ${full ? orderSelectionFull : orderSelection}
          }
        }`

        const data = await Vue.$api.graphql.request(q, null)

        if (target === 'orders') {
            commit('addOrder', new Order(data.order))
        } else {
            commit('setMyOrder', new Order(data.order))
        }
    },

    async fetchOrders({commit, state}, {tenantId, status, full}) {
        const q = `query {
          orders(tenantId: "${tenantId}", status: "${status}") {
            ${full ? orderSelectionFull : orderSelection}
          }
        }`

        const data = await Vue.$api.graphql.request(q, null)

        commit('setOrders', data.orders.map(Order.new))
    },

    async placeOrder({commit}, orderInput) {
        const q = `mutation($order: OrderInput!) {
          createOrder(order: $order) {
            id
            createdAt
            updatedAt
            eta
            status
            totalSum
            queueId
          }
        }`

        const vars = {
            order: orderInput
        }

        const data = await Vue.$api.graphql.request(q, vars)
        commit('setMyOrder', new Order(data.createOrder))
    },

    async modifyOrder({commit}, {id, status, eta}) {
        const q = `mutation($order: OrderUpdateInput!) {
          updateOrder(order: $order) {
            id
            status
            eta
          }
        }`

        const order = {id}
        if (status) order.status = status
        if (eta) order.eta = eta

        const vars = {
            order
        }

        await Vue.$api.graphql.request(q, vars)
        commit('updateOrder', order)
    },

    async subscribeOrderChanged({commit, state, getters}, {id}) {
        const orderRefs = getters.orderRefs(id)
        if (!orderRefs.length) return

        const q = `subscription {
            orderChanged(id: "${id}") {
                ${orderSelection}
           }
        }`

        const source = Vue.$api.sse.request(q, null)
        source.addEventListener('message', e => {
            const payload = JSON.parse(e.data)
            if (!payload || !payload.data || !payload.data.orderChanged) {
                console.error('property "orderChanged" not present on update event')
                return
            }
            commit('updateOrder', new Order(payload.data.orderChanged))
        })

        activeEventSources.push(source)
        source.stream()
    },

    async subscribeOrderCreated({commit, state}) {
        const q = `subscription {
            orderCreated() {
                ${orderSelectionFull}
           }
        }`

        const source = Vue.$api.sse.request(q, null)
        source.addEventListener('message', e => {
            const payload = JSON.parse(e.data)
            if (!payload || !payload.data || !payload.data.orderCreated) {
                console.error('property "orderCreated" not present on update event')
                return
            }
            commit('addOrder', new Order(payload.data.orderCreated))
        })

        activeEventSources.push(source)
        source.stream()
    }
}

export default {
    namespaced: true,
    state,
    getters,
    actions,
    mutations
}